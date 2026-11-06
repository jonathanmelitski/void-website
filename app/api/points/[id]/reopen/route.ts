import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getPoint, listPointsByGame, updatePoint } from "@/lib/aws/points"
import { getGame, updateGame } from "@/lib/aws/games"
import { listEventsByPoint, applyPointEventBatch } from "@/lib/aws/point-events"
import { pushGameUpdate } from "@/lib/ws-push"

interface Props {
  params: Promise<{ id: string }>
}

/** Events that end a point; reopening removes them so the point can be finished again. */
const SCORING_EVENTS = new Set(["GOAL", "ASSIST", "HOCKEY_ASSIST"])

/**
 * Undo a finished point (live scoring): only the game's latest point, and only if nothing has been
 * started after it. Removes its goal / assist / hockey assist, sets it back to IN_PROGRESS, and
 * restores the game's score to what it was before the point (un-finalising a game that hit cap).
 */
export async function POST(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { id } = await params
  try {
    const point = await getPoint(id)
    if (!point) return NextResponse.json({ error: "Point not found." }, { status: 404 })
    if (point.status !== "COMPLETE") return NextResponse.json({ error: "This point isn't finished." }, { status: 409 })

    const [game, points, events] = await Promise.all([getGame(point.gameId), listPointsByGame(point.gameId), listEventsByPoint(point.id)])
    if (!game) return NextResponse.json({ error: "Game not found." }, { status: 404 })
    if (points.some(p => p.pointNumber > point.pointNumber)) {
      return NextResponse.json({ error: "A later point has started. Edit this point from the point log instead." }, { status: 409 })
    }

    const removed = events.filter(e => SCORING_EVENTS.has(e.eventType)).map(e => e.id)
    if (removed.length > 0) await applyPointEventBatch(point.id, [], removed)

    const now = new Date().toISOString()
    await updatePoint(point.id, { status: "IN_PROGRESS", outcome: "IN_PROGRESS", updatedAt: now })

    const completedBefore = points.filter(p => p.status === "COMPLETE" && p.id !== point.id).length
    await updateGame(game.id, {
      scoreVoid: point.voidScoreBefore,
      scoreOpponent: point.opponentScoreBefore,
      status: "IN_PROGRESS",
      result: null,
      // Half marked after this point no longer makes sense once it's live again
      ...(game.secondHalfStartCompletedCount !== undefined && game.secondHalfStartCompletedCount > completedBefore
        ? { secondHalfStartCompletedCount: null } : {}),
      updatedAt: now,
    })

    pushGameUpdate(game.id).catch(() => {})
    const [updatedPoint, updatedGame] = await Promise.all([getPoint(point.id), getGame(game.id)])
    return NextResponse.json({ point: updatedPoint, game: updatedGame, removedEventIds: removed })
  } catch (err: unknown) {
    console.error(JSON.stringify({ event: "point_reopen_failed", pointId: id, error: err instanceof Error ? err.message : String(err) }))
    return NextResponse.json({ error: "Couldn't undo the point. Try again." }, { status: 500 })
  }
}
