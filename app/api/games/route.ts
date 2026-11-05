import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { listGamesByEvent, createGame } from "@/lib/aws/games"
import { getEvent } from "@/lib/aws/dynamo"
import { canViewEvent, getCaller } from "@/lib/event-access"
import { deriveScores } from "@/lib/derived-score"
import { publicReadHeaders } from "@/lib/http-cache"
import { randomUUID } from "crypto"

// Each game is the stored GameItem plus `derived: { scoreUs, scoreThem, result } | null`
// (score/result from the point record; see lib/derived-score.ts for when to prefer it).
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")
  if (!eventId) {
    return NextResponse.json({ error: "eventId query param is required" }, { status: 400 })
  }
  try {
    // Same rule as denyIfEventHidden: private events 404 for callers who can't see them;
    // a missing event has no privacy flag.
    const [event, caller] = await Promise.all([getEvent(eventId), getCaller(request)])
    if (event && !canViewEvent(event, caller)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const games = await listGamesByEvent(eventId)
    const derived = await deriveScores(games)
    return NextResponse.json(
      games.map(g => ({ ...g, derived: derived.get(g.id) ?? null })),
      // Scores move during live games: keep the anonymous browser cache very short
      { headers: publicReadHeaders(request, { maxAge: 5, swr: 30, isPrivateData: !!event?.isPrivate }) }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch games"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { eventId, opponent, round, scheduledTime, cap, voidReceivingFirst, notes } =
    await request.json()

  if (!eventId || !opponent) {
    return NextResponse.json({ error: "eventId and opponent are required" }, { status: 400 })
  }

  const now = new Date().toISOString()
  const item = {
    id: randomUUID(),
    eventId,
    opponent,
    ...(round ? { round } : {}),
    ...(scheduledTime ? { scheduledTime } : {}),
    cap: cap ?? 15,
    scoreVoid: 0,
    scoreOpponent: 0,
    status: "SCHEDULED" as const,
    voidReceivingFirst: voidReceivingFirst ?? false,
    ...(notes ? { notes } : {}),
    createdAt: now,
    updatedAt: now,
  }

  try {
    await createGame(item)
    return NextResponse.json(item, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create game"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
