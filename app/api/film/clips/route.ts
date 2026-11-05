import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { listClipsByGame } from "@/lib/aws/film-clips"

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get("gameId")
  if (!gameId) return NextResponse.json({ error: "gameId is required" }, { status: 400 })

  const auth = await requireUser(request)
  if (!auth.ok) return auth.response

  try {
    const clips = await listClipsByGame(gameId)
    return NextResponse.json(clips)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch clips"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
