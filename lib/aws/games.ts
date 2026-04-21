import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// DynamoDB table: VoidGames
// GSI: EventIdIndex — PK: eventId, SK: scheduledTime (projects all)
const TABLE = () => process.env.DYNAMO_GAMES_TABLE!

export type GameStatus = "SCHEDULED" | "IN_PROGRESS" | "FINAL"
export type GameResult = "WIN" | "LOSS" | "TIE"

export type GameItem = {
  id: string
  eventId: string             // FK → EventItem (VoidEvents)
  opponent: string            // opponent team name (free text)
  round?: string              // "Pool A", "Quarterfinal", etc.
  scheduledTime?: string      // ISO datetime
  cap: number                 // game-to score; default 15
  scoreVoid: number           // updated on each point completion for fast list renders
  scoreOpponent: number
  status: GameStatus
  result?: GameResult
  voidReceivingFirst: boolean // true = VOID received the first pull of the game
  secondHalfStartCompletedCount?: number // number of completed points when second half was marked
  notes?: string
  createdAt: string
  updatedAt: string
}

export async function listGamesByEvent(eventId: string): Promise<GameItem[]> {
  const result = await dynamo.send(
    new ScanCommand({
      TableName: TABLE(),
      FilterExpression: "eventId = :eventId",
      ExpressionAttributeValues: { ":eventId": eventId },
    })
  )
  return ((result.Items ?? []) as GameItem[]).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
}

export async function getGame(id: string): Promise<GameItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { id } })
  )
  return (result.Item as GameItem) ?? null
}

export async function createGame(item: GameItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function updateGame(
  id: string,
  fields: Partial<Omit<GameItem, "id" | "eventId" | "createdAt">>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return
  const sets = entries.map(([k], i) => `#f${i} = :v${i}`)
  const names = Object.fromEntries(entries.map(([k], i) => [`#f${i}`, k]))
  const values = Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v]))
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { id },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  )
}

export async function deleteGame(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}
