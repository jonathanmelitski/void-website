import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getPoint, updatePoint, deletePoint } from "@/lib/aws/points"
import { updateGame } from "@/lib/aws/games"
import { pushGameUpdate } from "@/lib/ws-push"
import type { GameResult } from "@/lib/aws/games"

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const point = await getPoint(id)
    if (!point) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(point)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch point"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Props) {
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

  const { id } = await params
  const fields = await request.json()
  const now = new Date().toISOString()

  try {
    const existing = await getPoint(id)
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await updatePoint(id, { ...fields, updatedAt: now })

    const { getGame } = await import("@/lib/aws/games")

    // If the point is being completed for the first time, update the game score
    if (fields.outcome && fields.outcome !== "IN_PROGRESS" && fields.status === "COMPLETE") {
      const isHold = fields.outcome === "HOLD"
      const voidScores = isHold
        ? (existing.lineType === "O") // O-line hold = VOID scored
        : (existing.lineType === "D") // D-line break = VOID scored

      const newScoreVoid = existing.voidScoreBefore + (voidScores ? 1 : 0)
      const newScoreOpponent = existing.opponentScoreBefore + (voidScores ? 0 : 1)

      const game = await getGame(existing.gameId)
      if (game) {
        const isGameOver = newScoreVoid >= game.cap || newScoreOpponent >= game.cap
        let result: GameResult | undefined
        if (isGameOver) {
          result = newScoreVoid > newScoreOpponent ? "WIN" : newScoreVoid < newScoreOpponent ? "LOSS" : "TIE"
        }
        await updateGame(existing.gameId, {
          scoreVoid: newScoreVoid,
          scoreOpponent: newScoreOpponent,
          ...(isGameOver ? { status: "FINAL", result } : { status: "IN_PROGRESS" }),
          updatedAt: now,
        })
      }
    }

    // If editing an already-complete point's outcome or lineType, recalculate score delta
    if (
      existing.status === "COMPLETE" &&
      fields.status !== "IN_PROGRESS" &&
      (fields.outcome !== undefined || fields.lineType !== undefined)
    ) {
      const oldLineType = existing.lineType
      const oldOutcome = existing.outcome as string
      const newLineType = fields.lineType ?? existing.lineType
      const newOutcome = (fields.outcome ?? existing.outcome) as string

      const oldVoidScored =
        (oldOutcome === "HOLD" && oldLineType === "O") ||
        (oldOutcome === "BREAK" && oldLineType === "D")
      const newVoidScored =
        (newOutcome === "HOLD" && newLineType === "O") ||
        (newOutcome === "BREAK" && newLineType === "D")

      if (oldVoidScored !== newVoidScored) {
        const game = await getGame(existing.gameId)
        if (game) {
          const newScoreVoid = game.scoreVoid + (newVoidScored ? 1 : -1)
          const newScoreOpponent = game.scoreOpponent + (newVoidScored ? -1 : 1)
          const isGameOver = newScoreVoid >= game.cap || newScoreOpponent >= game.cap
          let result: GameResult | undefined
          if (isGameOver) {
            result = newScoreVoid > newScoreOpponent ? "WIN" : newScoreVoid < newScoreOpponent ? "LOSS" : "TIE"
          }
          await updateGame(existing.gameId, {
            scoreVoid: newScoreVoid,
            scoreOpponent: newScoreOpponent,
            ...(isGameOver ? { result } : {}),
            updatedAt: now,
          })
        }
      }
    }

    const updated = await getPoint(id)
    pushGameUpdate(existing.gameId).catch(() => {})
    return NextResponse.json(updated)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update point"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
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

  const { id } = await params
  try {
    await deletePoint(id)
    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete point"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
