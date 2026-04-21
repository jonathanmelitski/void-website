import {
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// DynamoDB table: VoidPointEvents
// GSI 1: PointIdIndex — PK: pointId, SK: sortOrder (number, projects all)
// GSI 2: GameIdIndex  — PK: gameId,  SK: sortOrder (number, projects all)
const TABLE = () => process.env.DYNAMO_POINT_EVENTS_TABLE!

export type PointEventType = "GOAL" | "ASSIST" | "TURNOVER" | "BLOCK" | "PULL"

export type PointEventItem = {
  id: string
  pointId: string         // FK → PointItem
  gameId: string          // denormalized FK → GameItem (for single-query game-level aggregation)
  eventType: PointEventType
  playerId: string        // VOID player who performed the action
  sortOrder: number       // chronological sequence within the point (1, 2, 3…)
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
