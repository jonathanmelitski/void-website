import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

const TABLE = () => process.env.DYNAMO_PLAYERS_TABLE!

// Matches existing Player shape from RosterModels.tsx + createdAt
export type PlayerItem = {
  id: string
  first_name: string
  last_name: string
  number: number
  team: "VOID" | "NULL"
  is_captain: boolean
  jersey_name_text?: string
  is_active: boolean
  createdAt: string
}

export async function listPlayers(): Promise<PlayerItem[]> {
  const result = await dynamo.send(new ScanCommand({ TableName: TABLE() }))
  const items = (result.Items ?? []) as PlayerItem[]
  return items.sort((a, b) => {
    if (a.is_captain && !b.is_captain) return -1
    if (!a.is_captain && b.is_captain) return 1
    return a.last_name.localeCompare(b.last_name)
  })
}

export async function getPlayer(id: string): Promise<PlayerItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { id } })
  )
  return (result.Item as PlayerItem) ?? null
}

export async function createPlayer(item: PlayerItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function updatePlayer(
  id: string,
  fields: Partial<Omit<PlayerItem, "id" | "createdAt">>
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

export async function deletePlayer(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}
