import {
  BatchGetCommand,
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import { scanAll } from "./paginate"
import type { FilmTrack } from "../film-tracks"

// DynamoDB table: VoidGames
// GSI: EventIdIndex — PK: eventId, SK: scheduledTime (projects all)
const TABLE = () => process.env.DYNAMO_GAMES_TABLE!

export type GameStatus = "SCHEDULED" | "IN_PROGRESS" | "FINAL"
export type GameResult = "WIN" | "LOSS" | "TIE"

export type GameItem = {
  id: string
  eventId: string             // FK → EventItem (VoidEvents)
  opponent: string            // opponent team name (free text)
  round?: string              // "Pool A", "Quarterfinal", etc.
  scheduledTime?: string      // ISO datetime
  cap: number                 // game-to score; default 15
  scoreVoid: number           // updated on each point completion for fast list renders
  scoreOpponent: number
  status: GameStatus
  result?: GameResult
  voidReceivingFirst: boolean // true = VOID received the first pull of the game
  secondHalfStartCompletedCount?: number // number of completed points when second half was marked
  notes?: string
  filmTracks?: FilmTrack[]    // extra camera angles for film review (main track is implicit)
  createdAt: string
  updatedAt: string
}

// Stays a Scan: EventIdIndex's sort key is scheduledTime, which is optional, so the index is sparse
// and a Query would silently miss games created without a time. Pages through the whole table.
export async function listGamesByEvent(eventId: string): Promise<GameItem[]> {
  const items = await scanAll<GameItem>({
    TableName: TABLE(),
    FilterExpression: "eventId = :eventId",
    ExpressionAttributeValues: { ":eventId": eventId },
  })
  return items.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
}

// Several games by id in as few calls as possible (BatchGet: 100 keys per call). Missing ids are
// simply absent from the result; order is not preserved.
export async function getGames(ids: string[]): Promise<GameItem[]> {
  const unique = [...new Set(ids)]
  const out: GameItem[] = []
  for (let i = 0; i < unique.length; i += 100) {
    let keys: Record<string, unknown>[] | undefined = unique.slice(i, i + 100).map(id => ({ id }))
    for (let attempt = 0; keys && keys.length > 0 && attempt < 5; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 50 * 2 ** attempt))
      const result = await dynamo.send(new BatchGetCommand({ RequestItems: { [TABLE()]: { Keys: keys } } }))
      out.push(...((result.Responses?.[TABLE()] ?? []) as GameItem[]))
      keys = result.UnprocessedKeys?.[TABLE()]?.Keys as Record<string, unknown>[] | undefined
    }
    if (keys && keys.length > 0) throw new Error("Couldn't load all games")
  }
  return out
}

// Full-table Scan with a status filter (no status index), paged so nothing past 1 MB is dropped.
export async function listGamesByStatus(status: GameStatus): Promise<GameItem[]> {
  return scanAll<GameItem>({
    TableName: TABLE(),
    FilterExpression: "#s = :s",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": status },
  })
}

export async function getGame(id: string): Promise<GameItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { id } })
  )
  return (result.Item as GameItem) ?? null
}

export async function createGame(item: GameItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function updateGame(
  id: string,
  fields: Partial<Omit<GameItem, "id" | "eventId" | "createdAt">>
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

export async function deleteGame(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}
