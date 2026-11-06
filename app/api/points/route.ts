import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { listPointsByGame, listPointsByPlayer, createPoint } from "@/lib/aws/points"
import { canViewEvent, denyIfGameHidden, getCaller } from "@/lib/event-access"
import { getGames } from "@/lib/aws/games"
import { getEvent } from "@/lib/aws/dynamo"
import { NO_STORE_HEADERS } from "@/lib/http-cache"
import { isTestGame } from "@/lib/test-games"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get("gameId")
  const playerId = request.nextUrl.searchParams.get("playerId")

  if (!gameId && !playerId) {
    return NextResponse.json({ error: "gameId or playerId query param is required" }, { status: 400 })
  }

  if (playerId) {
    const auth = await requireUser(request)
    if (!auth.ok) return auth.response

    try {
      const [points, caller] = await Promise.all([listPointsByPlayer(playerId), getCaller(request)])
      // Drop points from private events the caller can't see (same rule as canViewGame: a deleted
      // game or event has no privacy flag). One BatchGet for the games, one GetItem per event.
      const games = await getGames([...new Set(points.map(p => p.gameId))])
      const eventIds = [...new Set(games.map(g => g.eventId))]
      const events = await Promise.all(eventIds.map(id => getEvent(id)))
      const hiddenEvents = new Set(events.filter(e => e && !canViewEvent(e, caller)).map(e => e!.id))
      const hiddenGames = new Set(games.filter(g => hiddenEvents.has(g.eventId) || isTestGame(g)).map(g => g.id))
      return NextResponse.json(points.filter(p => !hiddenGames.has(p.gameId)), { headers: NO_STORE_HEADERS })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch points"
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  try {
    const denied = await denyIfGameHidden(request, gameId!)
    if (denied) return denied
    const points = await listPointsByGame(gameId!)
    return NextResponse.json(points)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch points"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const {
    gameId,
    pointNumber,
    lineType,
    voidScoreBefore,
    opponentScoreBefore,
    playerIds,
  } = await request.json()

  if (!gameId || pointNumber === undefined || !lineType || voidScoreBefore === undefined || opponentScoreBefore === undefined) {
    return NextResponse.json(
      { error: "gameId, pointNumber, lineType, voidScoreBefore, and opponentScoreBefore are required" },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const item = {
    id: randomUUID(),
    gameId,
    pointNumber,
    lineType,
    outcome: "IN_PROGRESS" as const,
    voidScoreBefore,
    opponentScoreBefore,
    playerIds: playerIds ?? [],
    status: "IN_PROGRESS" as const,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await createPoint(item)
    return NextResponse.json(item, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create point"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
