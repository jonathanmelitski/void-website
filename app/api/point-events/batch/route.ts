import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { getPoint } from "@/lib/aws/points"
import {
  listEventsByPoint,
  applyPointEventBatch,
  POINT_EVENT_TYPES,
  type PointEventItem,
  type PointEventType,
} from "@/lib/aws/point-events"
import { pushGameUpdate } from "@/lib/ws-push"
import {
  eventNeedsPlayer, FIELD_ZONES, HUCKABLE_TYPES, OPP_TURNOVER_TYPES, TURNOVER_TYPES, ZONABLE_TYPES,
  type FieldZone, type PullResult, type TurnoverType,
} from "@/lib/point-event-meta"

type UpsertInput = {
  id: string
  eventType: PointEventType
  playerId?: string
  playerInId?: string
  team?: "VOID" | "OPP"
  sortOrder: number
  filmOffsetMs?: number
  // Details: omitted = keep what's stored (older clients); null/false = clear; a value = set
  pullResult?: PullResult | null
  turnoverType?: TurnoverType | null
  huck?: boolean | null
  zone?: FieldZone | null
}

/** Validation error for one upsert's details, or null. Mirrors PATCH /api/point-events/[id]. */
function detailError(u: UpsertInput): string | null {
  if (u.pullResult != null && (u.eventType !== "PULL" || (u.pullResult !== "IN" && u.pullResult !== "OUT"))) {
    return "pullResult must be IN or OUT on a pull."
  }
  if (u.turnoverType != null) {
    const allowed = u.eventType === "TURNOVER" ? TURNOVER_TYPES : u.eventType === "OPP_TURNOVER" ? OPP_TURNOVER_TYPES : []
    if (!allowed.includes(u.turnoverType)) return "Not a valid turnover type for this event."
  }
  if (u.huck != null && (typeof u.huck !== "boolean" || (u.huck && !HUCKABLE_TYPES.includes(u.eventType)))) {
    return "Only goals, assists and turnovers can be hucks."
  }
  if (u.zone != null && (!FIELD_ZONES.includes(u.zone) || !ZONABLE_TYPES.includes(u.eventType))) {
    return "Not a valid field zone for this event."
  }
  return null
}

function detailFields(u: UpsertInput, prev: PointEventItem | undefined): Partial<PointEventItem> {
  const sameType = prev?.eventType === u.eventType
  const pick = <K extends "pullResult" | "turnoverType" | "zone">(key: K) =>
    key in u ? u[key] ?? undefined : sameType ? prev?.[key] : undefined
  const pullResult = pick("pullResult")
  const turnoverType = pick("turnoverType")
  const zone = pick("zone")
  const huck = "huck" in u ? !!u.huck : sameType && !!prev?.huck
  return {
    ...(pullResult && u.eventType === "PULL" ? { pullResult } : {}),
    ...(turnoverType && (u.eventType === "TURNOVER" || u.eventType === "OPP_TURNOVER") ? { turnoverType } : {}),
    ...(huck && HUCKABLE_TYPES.includes(u.eventType) ? { huck: true } : {}),
    ...(zone && ZONABLE_TYPES.includes(u.eventType) ? { zone } : {}),
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Saves the film editor's changes to one point's events in a single transaction
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { permission: "games.score" })
  if (!auth.ok) return auth.response

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
    if (eventNeedsPlayer(u.eventType, u.team) && !u.playerId) {
      return NextResponse.json({ error: `${u.eventType} needs a player` }, { status: 400 })
    }
    if (u.eventType === "TIMEOUT" && u.team !== "VOID" && u.team !== "OPP") {
      return NextResponse.json({ error: "TIMEOUT needs a team" }, { status: 400 })
    }
    if (!Number.isInteger(u.sortOrder)) return NextResponse.json({ error: "sortOrder must be an integer" }, { status: 400 })
    if (u.filmOffsetMs !== undefined && (!Number.isFinite(u.filmOffsetMs) || u.filmOffsetMs < 0)) {
      return NextResponse.json({ error: "filmOffsetMs must be a non-negative number (events can't precede the point)" }, { status: 400 })
    }
    const detail = detailError(u)
    if (detail) return NextResponse.json({ error: detail }, { status: 400 })
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
      ...((u.eventType === "TIMEOUT" || u.eventType === "PULL") && u.team ? { team: u.team } : {}),
      sortOrder: u.sortOrder,
      ...(u.filmOffsetMs !== undefined ? { filmOffsetMs: Math.round(u.filmOffsetMs) } : {}),
      // Live-only details are kept while the event stays the same type
      ...(prev?.occurredAt ? { occurredAt: prev.occurredAt } : {}),
      ...(prev?.eventType === "PULL" && u.eventType === "PULL" && prev.hangTimeMs !== undefined ? { hangTimeMs: prev.hangTimeMs } : {}),
      // Editable details: sent = use it (null clears); not sent = keep the stored one if it still applies
      ...detailFields(u, prev),
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
