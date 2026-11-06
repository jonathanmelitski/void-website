import { NextResponse } from "next/server"
import { getEvent } from "@/lib/aws/dynamo"
import { listGamesByStatus } from "@/lib/aws/games"
import { deriveScores } from "@/lib/derived-score"
import { isTestGame } from "@/lib/test-games"

// The body never depends on the caller and never includes private-event games, so a very short
// shared cache is safe; it absorbs navbar polling from many viewers.
const CACHE = { "Cache-Control": "public, max-age=5, s-maxage=5, stale-while-revalidate=30" }

// IN_PROGRESS games of non-private events, for everyone (same list whoever asks).
// Each item: { id, opponent, round?, scoreVoid, scoreOpponent, eventId,
//              derived: { scoreUs, scoreThem, result } | null }   — see lib/derived-score.ts.
// While a game is IN_PROGRESS the stored scoreVoid/scoreOpponent stay authoritative for display.
export async function GET() {
  try {
    const games = (await listGamesByStatus("IN_PROGRESS")).filter(g => !isTestGame(g)) // paged Scan (no status index)
    if (games.length === 0) return NextResponse.json([], { headers: CACHE })

    // Fetch events for all unique eventIds to check privacy
    const uniqueEventIds = [...new Set(games.map(g => g.eventId).filter(Boolean))]
    const events = await Promise.all(uniqueEventIds.map(id => getEvent(id)))
    const privateEventIds = new Set(
      events.filter(e => e?.isPrivate).map(e => e!.id)
    )

    const publicGames = games.filter(g => !privateEventIds.has(g.eventId))
    const derived = await deriveScores(publicGames)
    // Same fields the old ProjectionExpression returned (absent attributes stay absent)
    const body = publicGames.map(g => ({
      id: g.id,
      opponent: g.opponent,
      ...(g.round !== undefined ? { round: g.round } : {}),
      scoreVoid: g.scoreVoid,
      scoreOpponent: g.scoreOpponent,
      eventId: g.eventId,
      derived: derived.get(g.id) ?? null,
    }))
    return NextResponse.json(body, { headers: CACHE })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch live games"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
