import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getClip, updateClip, deleteClip, listClipsByGame } from "@/lib/aws/film-clips"
import { getGame, updateGame } from "@/lib/aws/games"
import {
  getYouTubeVideoStatus,
  deleteYouTubeVideo,
  removeVideoFromPlaylist,
  createGamePlaylist,
  addVideoToPlaylist,
} from "@/lib/aws/youtube"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  try {
    let clip = await getClip(id)
    if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (clip.status === "TRANSCODING" && clip.youtubeVideoId) {
      try {
        const { uploadStatus, durationSeconds } = await getYouTubeVideoStatus(clip.youtubeVideoId)
        const now = new Date().toISOString()
        if (uploadStatus === "processed") {
          await updateClip(id, {
            status: "READY",
            updatedAt: now,
            ...(durationSeconds != null ? { durationSeconds } : {}),
          })
          clip = { ...clip, status: "READY", ...(durationSeconds != null ? { durationSeconds } : {}) }
        } else if (uploadStatus === "failed") {
          await updateClip(id, { status: "ERROR", errorMessage: "YouTube processing failed", updatedAt: now })
          clip = { ...clip, status: "ERROR", errorMessage: "YouTube processing failed" }
        }
      } catch {
        // YouTube status check failed — return current DB state
      }
    }

    return NextResponse.json(clip)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

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
  const { title, sortOrder, youtubeVideoId } = body as {
    title?: string
    sortOrder?: number
    youtubeVideoId?: string
  }

  try {
    const now = new Date().toISOString()

    if (youtubeVideoId) {
      // Upload completion: persist the video ID and start transcoding polling immediately.
      // Playlist attachment is best-effort — a failure here must not block the clip.
      const clip = await getClip(id)
      if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })

      await updateClip(id, { youtubeVideoId, status: "TRANSCODING", updatedAt: now })

      // Attach to YouTube playlist asynchronously — failure is non-fatal
      void (async () => {
        try {
          const game = await getGame(clip.gameId)
          if (!game) return

          let playlistId = game.youtubePlaylistId
          if (!playlistId) {
            const playlistTitle = `Void vs ${game.opponent}${game.round ? ` · ${game.round}` : ""}`
            playlistId = await createGamePlaylist(playlistTitle)
            await updateGame(clip.gameId, { youtubePlaylistId: playlistId })
          }

          const allClips = await listClipsByGame(clip.gameId)
          const position = allClips.filter(
            c => c.id !== id && c.youtubePlaylistItemId && (c.sortOrder ?? 0) < (clip.sortOrder ?? 0)
          ).length

          const youtubePlaylistItemId = await addVideoToPlaylist({
            playlistId,
            videoId: youtubeVideoId,
            position,
          })

          await updateClip(id, { youtubePlaylistItemId, updatedAt: new Date().toISOString() })
        } catch {
          // Playlist attachment failed — clip is still TRANSCODING and will be polled to READY.
          // Reorder will re-attach it to the playlist when the coach next adjusts clip order.
        }
      })()

      return NextResponse.json({ ok: true })
    }

    const updates: Record<string, unknown> = { updatedAt: now }
    if (title !== undefined) updates.title = title
    if (sortOrder !== undefined) updates.sortOrder = sortOrder
    await updateClip(id, updates)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

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

  try {
    const clip = await getClip(id)
    await deleteClip(id)

    // Fire-and-forget YouTube cleanup
    if (clip) {
      void (async () => {
        if (clip.youtubePlaylistItemId) {
          await removeVideoFromPlaylist(clip.youtubePlaylistItemId).catch(() => {})
        }
        if (clip.youtubeVideoId) {
          await deleteYouTubeVideo(clip.youtubeVideoId).catch(() => {})
        }
      })()
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
