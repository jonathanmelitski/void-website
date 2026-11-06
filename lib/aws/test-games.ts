import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import { deleteGame, type GameItem } from "./games"
import { listPointsByGame } from "./points"
import { listEventsByGame } from "./point-events"
import { listGamePlayers } from "./game-players"
import { isTestGame } from "../test-games"

async function batchDelete(table: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 25) {
    let items: Record<string, unknown>[] | undefined = ids.slice(i, i + 25).map(id => ({ DeleteRequest: { Key: { id } } }))
    for (let attempt = 0; items?.length && attempt < 6; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 50 * 2 ** attempt))
      const res = await dynamo.send(new BatchWriteCommand({ RequestItems: { [table]: items as never } }))
      items = res.UnprocessedItems?.[table] as Record<string, unknown>[] | undefined
    }
    if (items?.length) throw new Error(`Couldn't delete ${items.length} rows from ${table}`)
  }
}

/**
 * Deletes a test game and everything recorded under it: point events, points, roster rows, then the
 * game itself (last, so a failure part-way can simply be retried). Refuses anything not a test game.
 */
export async function discardTestGame(game: GameItem): Promise<{ points: number; events: number; roster: number }> {
  if (!isTestGame(game)) throw new Error("Only test games can be discarded")
  const [points, events, roster] = await Promise.all([
    listPointsByGame(game.id),
    listEventsByGame(game.id),
    listGamePlayers(game.id),
  ])
  await batchDelete(process.env.DYNAMO_POINT_EVENTS_TABLE!, events.map(e => e.id))
  await batchDelete(process.env.DYNAMO_POINTS_TABLE!, points.map(p => p.id))
  await batchDelete(process.env.DYNAMO_GAME_PLAYERS_TABLE!, roster.map(r => r.id))
  await deleteGame(game.id)
  return { points: points.length, events: events.length, roster: roster.length }
}
