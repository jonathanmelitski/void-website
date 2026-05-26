import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getClip, updateClip } from "@/lib/aws/film-clips"
import { getGame } from "@/lib/aws/games"
import { movePlaylistItem } from "@/lib/aws/youtube"

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

  const body = await request.json()
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: "Body must be a non-empty array of { id, sortOrder }" }, { status: 400 })
  }

  const sorted: { id: string; sortOrder: number }[] = [...body].sort(
    (a, b) => a.sortOrder - b.sortOrder
  )

  // Load clips and resolve playlist info from the first clip's game
  const clips = await Promise.all(sorted.map(({ id }) => getClip(id)))
  const validClips = clips.filter((c): c is NonNullable<typeof c> => c !== null)

  const gameId = validClips[0]?.gameId
  const game = gameId ? await getGame(gameId) : null
  const playlistId = game?.youtubePlaylistId

  const now = new Date().toISOString()

  // Update DynamoDB sortOrders in parallel
  await Promise.all(
    sorted.map(({ id, sortOrder }) =>
      updateClip(id, { sortOrder, updatedAt: now })
    )
  )

  // Sync YouTube playlist order sequentially (positions shift on each move)
  if (playlistId) {
    for (let i = 0; i < validClips.length; i++) {
      const clip = validClips[i]
      if (clip.youtubePlaylistItemId && clip.youtubeVideoId) {
        await movePlaylistItem({
          playlistItemId: clip.youtubePlaylistItemId,
          playlistId,
          videoId: clip.youtubeVideoId,
          newPosition: i,
        }).catch(() => {})
      }
    }
  }

  return NextResponse.json({ ok: true })
}
