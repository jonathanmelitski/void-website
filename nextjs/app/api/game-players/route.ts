import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listGamePlayers, createGamePlayer } from "@/lib/aws/game-players"
import { pushGameUpdate } from "@/lib/ws-push"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get("gameId")
  if (!gameId) {
    return NextResponse.json({ error: "gameId query param is required" }, { status: 400 })
  }
  try {
    const gamePlayers = await listGamePlayers(gameId)
    return NextResponse.json(gamePlayers)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch game players"
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

  const { gameId, playerId } = await request.json()
  if (!gameId || !playerId) {
    return NextResponse.json({ error: "gameId and playerId are required" }, { status: 400 })
  }

  const item = {
    id: randomUUID(),
    gameId,
    playerId,
    createdAt: new Date().toISOString(),
  }

  try {
    await createGamePlayer(item)
    pushGameUpdate(gameId).catch(() => {})
    return NextResponse.json(item, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add game player"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
