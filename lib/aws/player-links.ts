import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// DynamoDB table: VoidPlayerLinks
// PK: cognitoSub
// GSI: PlayerIdIndex — PK: playerId (projects all)
const TABLE = () => process.env.DYNAMO_PLAYER_LINKS_TABLE!

export type VoidPlayerLinkItem = {
  cognitoSub: string
  playerId: string
  linkedBy: string
  linkedAt: string
}

export async function getPlayerLink(cognitoSub: string): Promise<VoidPlayerLinkItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { cognitoSub } })
  )
  return (result.Item as VoidPlayerLinkItem) ?? null
}

export async function getPlayerLinkByPlayerId(playerId: string): Promise<VoidPlayerLinkItem | null> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "PlayerIdIndex",
      KeyConditionExpression: "playerId = :playerId",
      ExpressionAttributeValues: { ":playerId": playerId },
      Limit: 1,
    })
  )
  return ((result.Items ?? [])[0] as VoidPlayerLinkItem) ?? null
}

export async function createPlayerLink(item: VoidPlayerLinkItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function deletePlayerLink(cognitoSub: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { cognitoSub } }))
}

export async function listPlayerLinks(): Promise<VoidPlayerLinkItem[]> {
  const result = await dynamo.send(new ScanCommand({ TableName: TABLE() }))
  return (result.Items ?? []) as VoidPlayerLinkItem[]
}
