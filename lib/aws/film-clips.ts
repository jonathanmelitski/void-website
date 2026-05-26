import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// DynamoDB table: VoidFilmClips
// GSI: GameIdIndex — PK: gameId, SK: createdAt (projects all)
const TABLE = () => process.env.DYNAMO_FILM_CLIPS_TABLE!

export type FilmClipStatus = "UPLOADING" | "TRANSCODING" | "READY" | "ERROR"

export type FilmClipItem = {
  id: string
  gameId: string
  title?: string
  youtubeVideoId?: string
  youtubePlaylistItemId?: string
  uploadSessionUrl?: string
  status: FilmClipStatus
  errorMessage?: string
  durationSeconds?: number
  sortOrder?: number
  uploadedBy: string
  createdAt: string
  updatedAt: string
}

export async function listClipsByGame(gameId: string): Promise<FilmClipItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: "GameIdIndex",
      KeyConditionExpression: "gameId = :gameId",
      ExpressionAttributeValues: { ":gameId": gameId },
    })
  )
  return (result.Items ?? []) as FilmClipItem[]
}

export async function getClip(id: string): Promise<FilmClipItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { id } })
  )
  return (result.Item as FilmClipItem) ?? null
}

export async function createClip(item: FilmClipItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function updateClip(
  id: string,
  fields: Partial<Omit<FilmClipItem, "id" | "gameId" | "createdAt">>
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

export async function deleteClip(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}
