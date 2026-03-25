import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listGamesByEvent, createGame } from "@/lib/aws/games"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")
  if (!eventId) {
    return NextResponse.json({ error: "eventId query param is required" }, { status: 400 })
  }
  try {
    const games = await listGamesByEvent(eventId)
    return NextResponse.json(games)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch games"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

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
