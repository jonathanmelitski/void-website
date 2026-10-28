import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getClip, updateClip, deleteClip, listClipsByGame } from "@/lib/aws/film-clips"
import type { FilmSyncPoint } from "@/lib/film-tracks"

const MAX_SYNC_POINTS = 500

// Validates an angle clip's sync points; sync anchors must be main-track clips of the same game
async function validateSyncPoints(raw: unknown, clipId: string, gameId: string): Promise<FilmSyncPoint[] | string> {
  if (!Array.isArray(raw)) return "syncPoints must be an array"
  if (raw.length > MAX_SYNC_POINTS) return `At most ${MAX_SYNC_POINTS} sync points`
  const ms = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0
  const out: FilmSyncPoint[] = []
  const ids = new Set<string>()
  for (const p of raw as Record<string, unknown>[]) {
    if (typeof p?.id !== "string" || !p.id || p.id.length > 64 || ids.has(p.id)) return "Each sync point needs a unique id"
    ids.add(p.id)
    if (!ms(p.clipMs)) return "clipMs must be a non-negative number"
    if (p.kind === "desync") {
      out.push({ id: p.id, kind: "desync", clipMs: Math.round(p.clipMs as number) })
    } else if (p.kind === "sync") {
      if (typeof p.mainClipId !== "string" || !ms(p.mainClipMs)) return "sync points need mainClipId and mainClipMs"
      out.push({ id: p.id, kind: "sync", clipMs: Math.round(p.clipMs as number), mainClipId: p.mainClipId, mainClipMs: Math.round(p.mainClipMs as number) })
    } else {
      return "kind must be sync or desync"
    }
  }
  const anchors = new Set(out.flatMap(p => p.kind === "sync" ? [p.mainClipId] : []))
  if (anchors.size > 0) {
    const mainIds = new Set((await listClipsByGame(gameId)).filter(c => !c.trackId && c.id !== clipId).map(c => c.id))
    for (const id of anchors) if (!mainIds.has(id)) return "Sync points must anchor to a main-track clip of this game"
  }
  return out
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  try {
    const clip = await getClip(id)
    if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(clip)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

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

  const body = await request.json()
  const { title, durationSeconds, syncPoints } = body as { title?: string; durationSeconds?: number; syncPoints?: unknown }

  try {
    const now = new Date().toISOString()
    const updates: Record<string, unknown> = { updatedAt: now }
    if (title !== undefined) updates.title = title
    if (durationSeconds !== undefined) updates.durationSeconds = durationSeconds
    if (syncPoints !== undefined) {
      const clip = await getClip(id)
      if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })
      if (!clip.trackId) return NextResponse.json({ error: "Only angle clips have sync points" }, { status: 400 })
      const validated = await validateSyncPoints(syncPoints, id, clip.gameId)
      if (typeof validated === "string") return NextResponse.json({ error: validated }, { status: 400 })
      updates.syncPoints = validated
    }
    await updateClip(id, updates)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

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

  try {
    await deleteClip(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
