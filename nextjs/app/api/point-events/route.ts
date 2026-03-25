import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listEventsByPoint, listEventsByGame, createPointEvent } from "@/lib/aws/point-events"
import { pushGameUpdate } from "@/lib/ws-push"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  const pointId = request.nextUrl.searchParams.get("pointId")
  const gameId = request.nextUrl.searchParams.get("gameId")

  if (!pointId && !gameId) {
    return NextResponse.json({ error: "pointId or gameId query param is required" }, { status: 400 })
  }

  try {
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

  const { pointId, gameId, eventType, playerId, sortOrder } = await request.json()

  if (!pointId || !gameId || !eventType || !playerId || sortOrder === undefined) {
    return NextResponse.json(
      { error: "pointId, gameId, eventType, playerId, and sortOrder are required" },
      { status: 400 }
    )
  }

  const VALID_TYPES = ["GOAL", "ASSIST", "TURNOVER", "BLOCK", "PULL"]
  if (!VALID_TYPES.includes(eventType)) {
    return NextResponse.json({ error: `eventType must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 })
  }

  const item = {
    id: randomUUID(),
    pointId,
    gameId,
    eventType,
    playerId,
    sortOrder,
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
