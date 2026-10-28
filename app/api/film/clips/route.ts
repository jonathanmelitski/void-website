import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listClipsByGame } from "@/lib/aws/film-clips"

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get("gameId")
  if (!gameId) return NextResponse.json({ error: "gameId is required" }, { status: 400 })

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  try {
    const clips = await listClipsByGame(gameId)
    return NextResponse.json(clips)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch clips"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
