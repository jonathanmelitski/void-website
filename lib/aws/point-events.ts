import {
  PutCommand,
  DeleteCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import type { PointEventType } from "../point-event-meta"
export type { PointEventType } from "../point-event-meta"
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
  playerId: string        // acting player (player going OUT for SUBSTITUTION, "" for TIMEOUT / PULL_FINISHED)
  playerInId?: string     // SUBSTITUTION only: player coming in
  team?: "VOID" | "OPP"  // TIMEOUT only: which team called it
  sortOrder: number
  // Film review: ms after the point's film marker. Absent until the point is edited against film;
  // until then the position is derived from createdAt spacing.
  filmOffsetMs?: number
  createdAt: string
}

export async function listEventsByPoint(pointId: string): Promise<PointEventItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "PointIdIndex",
      KeyConditionExpression: "pointId = :pointId",
      ExpressionAttributeValues: { ":pointId": pointId },
      ScanIndexForward: true, // ascending by sortOrder
    })
  )
  return (result.Items ?? []) as PointEventItem[]
}

export async function listEventsByGame(gameId: string): Promise<PointEventItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "GameIdIndex",
      KeyConditionExpression: "gameId = :gameId",
      ExpressionAttributeValues: { ":gameId": gameId },
      ScanIndexForward: true,
    })
  )
  return (result.Items ?? []) as PointEventItem[]
}

export async function createPointEvent(item: PointEventItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
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
