import {
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// DynamoDB table: VoidGamePlayers
// GSI 1: GameIdIndex  — PK: gameId  (projects all)
// GSI 2: PlayerIdIndex — PK: playerId (projects all)
const TABLE = () => process.env.DYNAMO_GAME_PLAYERS_TABLE!

export type GamePlayerItem = {
  id: string
  gameId: string    // FK → GameItem
  playerId: string  // FK → PlayerItem
  createdAt: string
}

export async function listGamePlayers(gameId: string): Promise<GamePlayerItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "GameIdIndex",
      KeyConditionExpression: "gameId = :gameId",
      ExpressionAttributeValues: { ":gameId": gameId },
    })
  )
  return (result.Items ?? []) as GamePlayerItem[]
}

export async function listPlayerGames(playerId: string): Promise<GamePlayerItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "PlayerIdIndex",
      KeyConditionExpression: "playerId = :playerId",
      ExpressionAttributeValues: { ":playerId": playerId },
    })
  )
  return (result.Items ?? []) as GamePlayerItem[]
}

export async function createGamePlayer(item: GamePlayerItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function deleteGamePlayer(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}
