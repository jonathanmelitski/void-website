import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listPointsByGame, createPoint } from "@/lib/aws/points"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get("gameId")
  if (!gameId) {
    return NextResponse.json({ error: "gameId query param is required" }, { status: 400 })
  }
  try {
    const points = await listPointsByGame(gameId)
    return NextResponse.json(points)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch points"
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
