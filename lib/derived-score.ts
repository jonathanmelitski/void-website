// Server-only: derived score/result for game lists. Read-only — never writes.
//
// Game list endpoints return the stored (cached) `scoreVoid/scoreOpponent/result`, which can drift
// from the point/point-event record (e.g. games scored in film). They now also carry
//
//   derived: { scoreUs: number, scoreThem: number, result: "WIN" | "LOSS" | "TIE" | null } | null
//
// computed by lib/stats/derive.ts from the game's points and point events (`null` only if loading
// them failed). Same rule as displayScore(): while a game is IN_PROGRESS the stored score stays
// authoritative for live surfaces (it moves in step with the console); otherwise prefer `derived`.
import type { GameItem } from "@/lib/aws/games"
import { listPointsByGame } from "@/lib/aws/points"
import { listEventsByGame } from "@/lib/aws/point-events"
import { deriveGameStats } from "@/lib/stats/derive"

export type DerivedScore = { scoreUs: number; scoreThem: number; result: GameItem["result"] | null }

type ScoreSource = Pick<GameItem, "id" | "status" | "scoreVoid" | "scoreOpponent"> & Partial<Pick<GameItem, "result" | "cap">>

// Points and point events have only a GameIdIndex (no event index), so this is two Queries per game,
// all in parallel — one round trip of latency for the whole list, not one per game.
export async function deriveScores(games: readonly ScoreSource[]): Promise<Map<string, DerivedScore | null>> {
  const entries = await Promise.all(
    games.map(async (game): Promise<[string, DerivedScore | null]> => {
      try {
        const [points, events] = await Promise.all([listPointsByGame(game.id), listEventsByGame(game.id)])
        const stats = deriveGameStats(game, points, events)
        return [game.id, { scoreUs: stats.score.us, scoreThem: stats.score.them, result: stats.result }]
      } catch (err) {
        console.error("deriveScores: failed for game", game.id, err instanceof Error ? err.name : err)
        return [game.id, null]
      }
    })
  )
  return new Map(entries)
}
