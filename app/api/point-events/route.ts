import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { listEventsByPoint, listEventsByGame, createPointEvent, POINT_EVENT_TYPES } from "@/lib/aws/point-events"
import { eventNeedsPlayer, TURNOVER_TYPES } from "@/lib/point-event-meta"
import { pushGameUpdate } from "@/lib/ws-push"
import { getPoint } from "@/lib/aws/points"
import { denyIfGameHidden } from "@/lib/event-access"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  const pointId = request.nextUrl.searchParams.get("pointId")
  const gameId = request.nextUrl.searchParams.get("gameId")

  if (!pointId && !gameId) {
    return NextResponse.json({ error: "pointId or gameId query param is required" }, { status: 400 })
  }

  try {
    const scopeGameId = pointId ? (await getPoint(pointId))?.gameId : gameId
    if (scopeGameId) {
      const denied = await denyIfGameHidden(request, scopeGameId)
      if (denied) return denied
    }
    const events = pointId
      ? await listEventsByPoint(pointId)
      : await listEventsByGame(gameId!)
    return NextResponse.json(events)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch point events"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { pointId, gameId, eventType, playerId, playerInId, team, sortOrder, occurredAt, pullResult, hangTimeMs, turnoverType } = await request.json()

  if (!pointId || !gameId || !eventType || sortOrder === undefined) {
    return NextResponse.json(
      { error: "pointId, gameId, eventType, and sortOrder are required" },
      { status: 400 }
    )
  }
  if (!POINT_EVENT_TYPES.includes(eventType)) {
    return NextResponse.json({ error: `eventType must be one of: ${POINT_EVENT_TYPES.join(", ")}` }, { status: 400 })
  }
  if (eventNeedsPlayer(eventType, team) && !playerId) {
    return NextResponse.json({ error: "playerId is required for this event type" }, { status: 400 })
  }
  if (occurredAt !== undefined && (typeof occurredAt !== "string" || Number.isNaN(Date.parse(occurredAt)))) {
    return NextResponse.json({ error: "occurredAt must be an ISO date" }, { status: 400 })
  }
  if (pullResult !== undefined && (eventType !== "PULL" || (pullResult !== "IN" && pullResult !== "OUT"))) {
    return NextResponse.json({ error: "pullResult must be IN or OUT on a PULL" }, { status: 400 })
  }
  if (turnoverType !== undefined && ((eventType !== "TURNOVER" && eventType !== "OPP_TURNOVER") || !TURNOVER_TYPES.includes(turnoverType))) {
    return NextResponse.json({ error: `turnoverType must be one of ${TURNOVER_TYPES.join(", ")} on a TURNOVER` }, { status: 400 })
  }
  if (hangTimeMs !== undefined && (eventType !== "PULL" || !Number.isFinite(hangTimeMs) || hangTimeMs < 0 || hangTimeMs > 60_000)) {
    return NextResponse.json({ error: "hangTimeMs must be 0–60000 on a PULL" }, { status: 400 })
  }

  const item = {
    id: randomUUID(),
    pointId,
    gameId,
    eventType,
    playerId: playerId ?? "",
    ...(playerInId ? { playerInId } : {}),
    ...(team ? { team } : {}),
    sortOrder,
    ...(occurredAt ? { occurredAt: new Date(occurredAt).toISOString() } : {}),
    ...(pullResult ? { pullResult } : {}),
    ...(hangTimeMs !== undefined ? { hangTimeMs: Math.round(hangTimeMs) } : {}),
    ...(turnoverType ? { turnoverType } : {}),
    createdAt: new Date().toISOString(),
  }

  try {
    await createPointEvent(item)
    pushGameUpdate(item.gameId).catch(() => {})
    return NextResponse.json(item, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create point event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
