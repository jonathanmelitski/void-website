import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { verifyToken } from "@/lib/aws/cognito"
import { createClip } from "@/lib/aws/film-clips"

function extractVideoId(input: string): string | null {
  const trimmed = input.trim()
  // youtu.be/ID
  const shortMatch = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (shortMatch) return shortMatch[1]
  // watch?v=ID or /shorts/ID or /embed/ID or /v/ID
  const longMatch = trimmed.match(/(?:[?&/]v(?:=|\/)|shorts\/|embed\/)([A-Za-z0-9_-]{11})/)
  if (longMatch) return longMatch[1]
  // bare 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed
  return null
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

  const { gameId, youtubeUrl, title, sortOrder } = await request.json()
  if (!gameId) return NextResponse.json({ error: "gameId is required" }, { status: 400 })
  if (!youtubeUrl) return NextResponse.json({ error: "youtubeUrl is required" }, { status: 400 })

  const videoId = extractVideoId(youtubeUrl)
  if (!videoId) return NextResponse.json({ error: "Could not extract YouTube video ID from URL" }, { status: 400 })

  // Resolve title from oEmbed if not provided
  let resolvedTitle: string | undefined = title
  if (!resolvedTitle) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      const res = await fetch(oembedUrl)
      if (res.ok) {
        const data = await res.json()
        resolvedTitle = data.title as string | undefined
      }
    } catch {
      // oEmbed fetch failed — proceed without title
    }
  }

  const id = randomUUID()
  const now = new Date().toISOString()

  const clip = {
    id,
    gameId,
    sourceType: "YOUTUBE" as const,
    youtubeVideoId: videoId,
    status: "READY" as const,
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    uploadedBy: payload["cognito:username"] ?? payload.sub,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await createClip(clip)
    return NextResponse.json(clip, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to import clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
