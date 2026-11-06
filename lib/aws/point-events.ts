import {
  PutCommand,
  DeleteCommand,
  GetCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import { queryAll } from "./paginate"
import type { PointEventType } from "../point-event-meta"
export type { PointEventType, PullResult, TurnoverType } from "../point-event-meta"
import type { PullResult, TurnoverType } from "../point-event-meta"
export { POINT_EVENT_TYPES, PLAYERLESS_EVENT_TYPES } from "../point-event-meta"

// DynamoDB table: VoidPointEvents
// GSI 1: PointIdIndex — PK: pointId, SK: sortOrder (number, projects all)
// GSI 2: GameIdIndex  — PK: gameId,  SK: sortOrder (number, projects all)
const TABLE = () => process.env.DYNAMO_POINT_EVENTS_TABLE!


export type PointEventItem = {
  id: string
  pointId: string
  gameId: string
  eventType: PointEventType
  playerId: string        // acting player (player going OUT for SUBSTITUTION, "" for TIMEOUT / PULL_FINISHED / opponent PULL)
  playerInId?: string     // SUBSTITUTION only: player coming in
  team?: "VOID" | "OPP"  // TIMEOUT: which team called it. PULL: which team pulled
  sortOrder: number
  // Film review: ms after the point's film marker. Absent until the point is edited against film;
  // until then the position is derived from createdAt spacing.
  filmOffsetMs?: number
  // Live scoring: when it happened on the scorer's phone (createdAt is when the server got it).
  occurredAt?: string
  pullResult?: PullResult // PULL only: landed in or out of bounds
  hangTimeMs?: number     // PULL only: release to landing/catch, from the scorer's hold
  turnoverType?: TurnoverType // TURNOVER only
  createdAt: string
}

export async function listEventsByPoint(pointId: string): Promise<PointEventItem[]> {
  return queryAll<PointEventItem>({
    TableName: TABLE(),
    IndexName: "PointIdIndex",
    KeyConditionExpression: "pointId = :pointId",
    ExpressionAttributeValues: { ":pointId": pointId },
    ScanIndexForward: true, // ascending by sortOrder
  })
}

export async function listEventsByGame(gameId: string): Promise<PointEventItem[]> {
  return queryAll<PointEventItem>({
    TableName: TABLE(),
    IndexName: "GameIdIndex",
    KeyConditionExpression: "gameId = :gameId",
    ExpressionAttributeValues: { ":gameId": gameId },
    ScanIndexForward: true,
  })
}

export async function createPointEvent(item: PointEventItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function getPointEvent(id: string): Promise<PointEventItem | null> {
  const res = await dynamo.send(new GetCommand({ TableName: TABLE(), Key: { id } }))
  return (res.Item as PointEventItem) ?? null
}

/** Who did it (and pull in/out) only: time, order and type never change here. Null removes a field. */
export async function updatePointEventWho(
  id: string,
  fields: { playerId?: string; playerInId?: string | null; team?: "VOID" | "OPP" | null; pullResult?: PullResult | null; turnoverType?: TurnoverType | null },
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return
  const names = Object.fromEntries(entries.map(([k], i) => [`#f${i}`, k]))
  const sets = entries.flatMap(([, v], i) => (v === null ? [] : [`#f${i} = :v${i}`]))
  const removes = entries.flatMap(([, v], i) => (v === null ? [`#f${i}`] : []))
  const values = Object.fromEntries(entries.flatMap(([, v], i) => (v === null ? [] : [[`:v${i}`, v]])))
  await dynamo.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { id },
    UpdateExpression: [sets.length ? `SET ${sets.join(", ")}` : "", removes.length ? `REMOVE ${removes.join(", ")}` : ""].filter(Boolean).join(" "),
    ConditionExpression: "attribute_exists(id)",
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
  }))
}

export async function deletePointEvent(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}

// Applies one point's edits atomically (DynamoDB transactions cap at 100 actions).
// Writes are conditioned on the point so an edit can never touch another point's events.
export async function applyPointEventBatch(
  pointId: string,
  puts: { item: PointEventItem; isNew: boolean }[],
  deleteIds: string[]
): Promise<void> {
  const actions = [
    ...puts.map(({ item, isNew }) => ({
      Put: {
        TableName: TABLE(),
        Item: item,
        ...(isNew
          ? { ConditionExpression: "attribute_not_exists(id)" }
          : { ConditionExpression: "pointId = :pointId", ExpressionAttributeValues: { ":pointId": pointId } }),
      },
    })),
    ...deleteIds.map(id => ({
      Delete: {
        TableName: TABLE(),
        Key: { id },
        ConditionExpression: "pointId = :pointId",
        ExpressionAttributeValues: { ":pointId": pointId },
      },
    })),
  ]
  for (let i = 0; i < actions.length; i += 100) {
    await dynamo.send(new TransactWriteCommand({ TransactItems: actions.slice(i, i + 100) }))
  }
}
