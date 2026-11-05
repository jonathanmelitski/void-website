import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// Per-recipient rows written by the email-worker Lambda (PK sendId, SK email). Read-only here.
const TABLE = () => process.env.DYNAMO_SEND_RECIPIENTS_TABLE!

export type SendRecipientItem = {
  sendId: string
  email: string
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "DRYRUN"
  messageId?: string
  error?: string
  sentAt?: string
  updatedAt?: string
}

export async function listSendRecipients(sendId: string): Promise<SendRecipientItem[]> {
  const items: SendRecipientItem[] = []
  let startKey: Record<string, unknown> | undefined
  do {
    const res = await dynamo.send(new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "sendId = :id",
      ExpressionAttributeValues: { ":id": sendId },
      ExclusiveStartKey: startKey,
    }))
    items.push(...((res.Items ?? []) as SendRecipientItem[]))
    startKey = res.LastEvaluatedKey
  } while (startKey)
  return items
}
