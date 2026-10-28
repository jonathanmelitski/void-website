import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getPoint } from "@/lib/aws/points"
import {
  listEventsByPoint,
  applyPointEventBatch,
  POINT_EVENT_TYPES,
  PLAYERLESS_EVENT_TYPES,
  type PointEventItem,
  type PointEventType,
} from "@/lib/aws/point-events"
import { pushGameUpdate } from "@/lib/ws-push"

type UpsertInput = {
  id: string
  eventType: PointEventType
  playerId?: string
  playerInId?: string
  team?: "VOID" | "OPP"
  sortOrder: number
  filmOffsetMs?: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Saves the film editor's changes to one point's events in a single transaction
export async function POST(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const groups = payload["cognito:groups"] ?? []
  if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { pointId, upserts = [], deletes = [] } = await request.json() as {
    pointId?: string
    upserts?: UpsertInput[]
    deletes?: string[]
  }
  if (!pointId) return NextResponse.json({ error: "pointId is required" }, { status: 400 })
  if (!Array.isArray(upserts) || !Array.isArray(deletes)) {
    return NextResponse.json({ error: "upserts and deletes must be arrays" }, { status: 400 })
  }

  const point = await getPoint(pointId)
  if (!point) return NextResponse.json({ error: "Point not found" }, { status: 404 })

  for (const u of upserts) {
    if (!u.id || !UUID_RE.test(u.id)) return NextResponse.json({ error: "Each event needs a UUID id" }, { status: 400 })
    if (!POINT_EVENT_TYPES.includes(u.eventType)) {
      return NextResponse.json({ error: `Invalid eventType: ${u.eventType}` }, { status: 400 })
    }
    if (!PLAYERLESS_EVENT_TYPES.includes(u.eventType) && !u.playerId) {
      return NextResponse.json({ error: `${u.eventType} needs a player` }, { status: 400 })
    }
    if (u.eventType === "TIMEOUT" && u.team !== "VOID" && u.team !== "OPP") {
      return NextResponse.json({ error: "TIMEOUT needs a team" }, { status: 400 })
    }
    if (!Number.isInteger(u.sortOrder)) return NextResponse.json({ error: "sortOrder must be an integer" }, { status: 400 })
    if (u.filmOffsetMs !== undefined && (!Number.isFinite(u.filmOffsetMs) || u.filmOffsetMs < 0)) {
      return NextResponse.json({ error: "filmOffsetMs must be a non-negative number (events can't precede the point)" }, { status: 400 })
    }
  }

  const existing = new Map((await listEventsByPoint(pointId)).map(e => [e.id, e]))
  const now = new Date().toISOString()

  const puts = upserts.map(u => {
    const prev = existing.get(u.id)
    const item: PointEventItem = {
      id: u.id,
      pointId,
      gameId: point.gameId,
      eventType: u.eventType,
      playerId: u.playerId ?? "",
      ...(u.eventType === "SUBSTITUTION" && u.playerInId ? { playerInId: u.playerInId } : {}),
      ...(u.eventType === "TIMEOUT" && u.team ? { team: u.team } : {}),
      sortOrder: u.sortOrder,
      ...(u.filmOffsetMs !== undefined ? { filmOffsetMs: Math.round(u.filmOffsetMs) } : {}),
      createdAt: prev?.createdAt ?? now,
    }
    return { item, isNew: !prev }
  })
  const deleteIds = deletes.filter(id => existing.has(id))

  try {
    await applyPointEventBatch(pointId, puts, deleteIds)
    pushGameUpdate(point.gameId).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save point events"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
