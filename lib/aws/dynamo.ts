import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"

const client = new DynamoDBClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
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
