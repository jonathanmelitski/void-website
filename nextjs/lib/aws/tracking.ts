import { randomUUID } from "crypto"
import { DeleteCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

const TABLE = () => process.env.DYNAMO_TRACKING_TABLE!

export type TrackingEvent = {
  id: string
  type: "open" | "click"
  messageId: string
  sendId: string
  url?: string
  timestamp: string
}

export async function logTrackingEvent(event: Omit<TrackingEvent, "id">): Promise<void> {
  const record: TrackingEvent = { id: randomUUID(), ...event }
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: record }))
}

export async function deleteEventsForSend(sendId: string): Promise<void> {
  const events = await getEventsForSend(sendId)
  await Promise.all(
    events.map(e =>
      dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id: e.id } }))
    )
  )
}

export async function getEventsForSend(sendId: string): Promise<TrackingEvent[]> {
  const result = await dynamo.send(
    new ScanCommand({
      TableName: TABLE(),
      FilterExpression: "sendId = :s",
      ExpressionAttributeValues: { ":s": sendId },
    })
  )
  return (result.Items ?? []) as TrackingEvent[]
}
