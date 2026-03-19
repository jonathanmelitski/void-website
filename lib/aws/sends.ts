import { randomUUID } from "crypto"
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

const TABLE = () => process.env.DYNAMO_SENDS_TABLE!

export type SendRecord = {
  id: string
  newsletterId: string
  newsletterTitle: string
  listName: string
  sentAt: string
  sentBy: string
  recipientCount: number
}

export async function logSend(params: Omit<SendRecord, "id">): Promise<SendRecord> {
  const record: SendRecord = {
    id: randomUUID(),
    ...params,
  }
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: record }))
  return record
}

export async function listSends(limit = 100): Promise<SendRecord[]> {
  const result = await dynamo.send(new ScanCommand({ TableName: TABLE() }))
  const items = (result.Items ?? []) as SendRecord[]
  return items
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
    .slice(0, limit)
}
