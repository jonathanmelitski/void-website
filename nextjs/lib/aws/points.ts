import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// DynamoDB table: VoidPoints
// GSI: GameIdIndex — PK: gameId, SK: pointNumber (number, projects all)
const TABLE = () => process.env.DYNAMO_POINTS_TABLE!

export type PointLineType = "O" | "D" // O = VOID on offense (received pull), D = VOID on defense (pulling)
export type PointOutcome = "HOLD" | "BREAK" | "IN_PROGRESS"
export type PointStatus = "IN_PROGRESS" | "COMPLETE"

export type PointItem = {
  id: string
  gameId: string              // FK → GameItem
  pointNumber: number         // sequential 1-based index within the game
  lineType: PointLineType
  outcome: PointOutcome
  voidScoreBefore: number     // score at start of point — enables history reconstruction
  opponentScoreBefore: number
  playerIds: string[]         // VOID player IDs on the line for this point
  status: PointStatus
  createdAt: string
  updatedAt: string
}

export async function listPointsByGame(gameId: string): Promise<PointItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "GameIdIndex",
      KeyConditionExpression: "gameId = :gameId",
      ExpressionAttributeValues: { ":gameId": gameId },
      ScanIndexForward: true, // ascending by pointNumber
    })
  )
  return (result.Items ?? []) as PointItem[]
}

export async function getPoint(id: string): Promise<PointItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { id } })
  )
  return (result.Item as PointItem) ?? null
}

export async function createPoint(item: PointItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function updatePoint(
  id: string,
  fields: Partial<Omit<PointItem, "id" | "gameId" | "createdAt">>
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

export async function deletePoint(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}
