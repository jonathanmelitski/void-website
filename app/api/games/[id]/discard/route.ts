import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getGame } from "@/lib/aws/games"
import { discardTestGame } from "@/lib/aws/test-games"
import { isTestGame } from "@/lib/test-games"

interface Props {
  params: Promise<{ id: string }>
}

// Throws a test game away with everything scored in it. Real games are refused.
export async function POST(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { id } = await params
  try {
    const game = await getGame(id)
    if (!game) return new NextResponse(null, { status: 204 }) // already gone
    if (!isTestGame(game)) {
      return NextResponse.json({ error: "Only test games can be discarded." }, { status: 409 })
    }
    const removed = await discardTestGame(game)
    return NextResponse.json({ removed })
  } catch (err: unknown) {
    console.error(JSON.stringify({ event: "test_game_discard_failed", gameId: id, error: err instanceof Error ? err.message : String(err) }))
    return NextResponse.json({ error: "Couldn't discard the test game. Try again." }, { status: 500 })
  }
}
