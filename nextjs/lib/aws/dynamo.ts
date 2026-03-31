import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"

const client = new DynamoDBClient({
  region: process.env.VOID_REGION!,
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

export const dynamo = DynamoDBDocumentClient.from(client)

const TABLE = () => process.env.DYNAMO_EVENTS_TABLE!

export type EventItem = {
  id: string
  title: string
  date: string
  location?: string
  description?: string
  coverPhotoKey?: string
  isPrivate?: boolean
  allowedUsers?: string[]
  createdAt: string
}

export async function listEvents(): Promise<EventItem[]> {
  const result = await dynamo.send(new ScanCommand({ TableName: TABLE() }))
  const items = (result.Items ?? []) as EventItem[]
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export async function getEvent(id: string): Promise<EventItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { id } })
  )
  return (result.Item as EventItem) ?? null
}

export async function createEvent(item: EventItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function deleteEvent(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}

export async function updateEvent(
  id: string,
  patch: Partial<Pick<EventItem, "isPrivate" | "allowedUsers">>
): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return

  const ExpressionAttributeNames: Record<string, string> = {}
  const ExpressionAttributeValues: Record<string, unknown> = {}
  const setParts: string[] = []

  for (const [key, value] of entries) {
    ExpressionAttributeNames[`#${key}`] = key
    ExpressionAttributeValues[`:${key}`] = value
    setParts.push(`#${key} = :${key}`)
  }

  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { id },
      UpdateExpression: `SET ${setParts.join(", ")}`,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    })
  )
}
