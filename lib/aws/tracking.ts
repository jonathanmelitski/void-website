import { randomUUID } from "crypto"
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import { scanAll } from "./paginate"

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
  // No sendId index: full-table Scan, paged (the filter applies per 1 MB page)
  return scanAll<TrackingEvent>({
    TableName: TABLE(),
    FilterExpression: "sendId = :s",
    ExpressionAttributeValues: { ":s": sendId },
  })
}
