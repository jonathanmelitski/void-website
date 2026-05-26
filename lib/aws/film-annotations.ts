import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// DynamoDB table: VoidFilmAnnotations
// GSI: ClipIdIndex — PK: clipId, SK: videoTimestampMs (projects all)
const TABLE = () => process.env.DYNAMO_FILM_ANNOTATIONS_TABLE!

export type FilmAnnotationItem = {
  id: string
  clipId: string
  gameId: string
  pointEventId?: string
  pointId?: string
  videoTimestampMs: number
  text: string
  authorUsername: string
  authorDisplayName: string
  createdAt: string
  updatedAt: string
}

export async function listAnnotationsByClip(clipId: string): Promise<FilmAnnotationItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "ClipIdIndex",
      KeyConditionExpression: "clipId = :clipId",
      ExpressionAttributeValues: { ":clipId": clipId },
      ScanIndexForward: true,
    })
  )
  return (result.Items ?? []) as FilmAnnotationItem[]
}

export async function getAnnotation(id: string): Promise<FilmAnnotationItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { id } })
  )
  return (result.Item as FilmAnnotationItem) ?? null
}

export async function createAnnotation(item: FilmAnnotationItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function updateAnnotation(
  id: string,
  fields: Partial<Pick<FilmAnnotationItem, "text" | "updatedAt">>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
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

export async function deleteAnnotation(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}
