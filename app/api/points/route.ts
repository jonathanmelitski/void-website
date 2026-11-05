import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { listPointsByGame, listPointsByPlayer, createPoint } from "@/lib/aws/points"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get("gameId")
  const playerId = request.nextUrl.searchParams.get("playerId")

  if (!gameId && !playerId) {
    return NextResponse.json({ error: "gameId or playerId query param is required" }, { status: 400 })
  }

  if (playerId) {
    const auth = await requireUser(request)
    if (!auth.ok) return auth.response

    try {
      const points = await listPointsByPlayer(playerId)
      return NextResponse.json(points)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch points"
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  try {
    const points = await listPointsByGame(gameId!)
    return NextResponse.json(points)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch points"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

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
