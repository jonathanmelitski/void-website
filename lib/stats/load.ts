// Server-only: loads one game's records and derives its stats. Read-only — never writes.
import { getGame, type GameItem } from "@/lib/aws/games"
import { getEvent, type EventItem } from "@/lib/aws/dynamo"
import { listPointsByGame } from "@/lib/aws/points"
import { listEventsByGame } from "@/lib/aws/point-events"
import { listPlayers } from "@/lib/aws/players"
import { deriveGameStats, type GameStats } from "./derive"

export type LoadedGameStats = { game: GameItem; event: EventItem | null; stats: GameStats }

// All reads run in parallel: points and events by GameIdIndex (Query), the roster (Scan, small),
// and the game followed by its event (needed for the privacy check).
export async function loadGameStats(gameId: string): Promise<LoadedGameStats | null> {
  const [gameAndEvent, points, events, players] = await Promise.all([
    getGame(gameId).then(async game => ({ game, event: game ? await getEvent(game.eventId) : null })),
    listPointsByGame(gameId),
    listEventsByGame(gameId),
    listPlayers(),
  ])
  const { game, event } = gameAndEvent
  if (!game) return null
  return { game, event, stats: deriveGameStats(game, points, events, players) }
}
