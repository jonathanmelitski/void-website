import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { verifyToken } from "@/lib/aws/cognito"
import { listClipsByGame, createClip } from "@/lib/aws/film-clips"

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

  const { gameId, title, sortOrder, sourceType } = await request.json()
  if (!gameId) return NextResponse.json({ error: "gameId is required" }, { status: 400 })

  const resolvedSourceType: "S3_HLS" | "YOUTUBE" = sourceType === "YOUTUBE" ? "YOUTUBE" : "S3_HLS"
  const id = randomUUID()
  const now = new Date().toISOString()

  const clip = {
    id,
    gameId,
    sourceType: resolvedSourceType,
    ...(title ? { title } : {}),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    status: "UPLOADING" as const,
    uploadedBy: payload["cognito:username"] ?? payload.sub,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await createClip(clip)
    return NextResponse.json(clip, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
