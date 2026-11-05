import { randomUUID } from "crypto"
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import { scanAll } from "./paginate"

const TABLE = () => process.env.DYNAMO_SENDS_TABLE!

export type SendRecord = {
  id: string
  newsletterId: string
  newsletterTitle: string
  listName: string
  sendMode?: "list" | "test"
  sentAt: string
  sentBy: string
  recipientCount: number
  failedCount?: number
  failedRecipients?: string[]
  trackingEnabled?: boolean
  trackedLinks?: string[]
}

export async function logSend(
  params: Omit<SendRecord, "id">,
  id?: string
): Promise<SendRecord> {
  const record: SendRecord = {
    id: id ?? randomUUID(),
    ...params,
  }
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: record }))
  return record
}

export async function updateSend(id: string, fields: Partial<Omit<SendRecord, "id">>): Promise<void> {
  const existing = await getSend(id)
  if (!existing) return
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: { ...existing, ...fields } }))
}

export async function getSend(id: string): Promise<SendRecord | null> {
  const result = await dynamo.send(new GetCommand({ TableName: TABLE(), Key: { id } }))
  return (result.Item as SendRecord) ?? null
}

export async function deleteSend(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}

export async function listSends(limit = 100): Promise<SendRecord[]> {
  const items = await scanAll<SendRecord>({ TableName: TABLE() })
  return items
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
    .slice(0, limit)
}
