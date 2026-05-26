import { type NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getClip, updateClip } from "@/lib/aws/film-clips"
import { createYouTubeUploadSession, getYouTubeAuth } from "@/lib/aws/youtube"

export const maxDuration = 300

async function requireUploader(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  try {
    const payload = await verifyToken(token)
    const groups: string[] = payload["cognito:groups"] ?? []
    return groups.includes("COACH") || groups.includes("ADMIN") ? payload : null
  } catch {
    return null
  }
}

// Query YouTube for how many bytes have been received for an interrupted session.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await requireUploader(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const clip = await getClip(id)
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!clip.uploadSessionUrl) return NextResponse.json({ bytesReceived: 0, sessionValid: false })

  try {
    const auth = await getYouTubeAuth()
    const token = await auth.getAccessToken()
    const res = await fetch(clip.uploadSessionUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Length": "0",
        "Content-Range": "bytes */*",
      },
    })

    if (res.status === 308) {
      const range = res.headers.get("Range")
      const lastByte = range ? parseInt(range.split("-")[1] ?? "0") : -1
      return NextResponse.json({ bytesReceived: lastByte + 1, sessionValid: true })
    }

    if (res.status === 200 || res.status === 201) {
      // Upload somehow already completed — patch the clip and signal the client
      const data = await res.json().catch(() => null)
      if (data?.id) {
        const now = new Date().toISOString()
        await updateClip(id, { youtubeVideoId: data.id, status: "TRANSCODING", uploadSessionUrl: undefined, updatedAt: now })
      }
      return NextResponse.json({ bytesReceived: -1, sessionValid: false, youtubeVideoId: data?.id })
    }

    // 404/410/5xx — session expired
    return NextResponse.json({ bytesReceived: 0, sessionValid: false })
  } catch {
    return NextResponse.json({ bytesReceived: 0, sessionValid: false })
  }
}

// Proxy the file (or remainder of file) to YouTube.
// X-Upload-Offset: bytes already received (default 0 = fresh upload)
// X-Upload-Total:  total file size in bytes (required when offset > 0)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await requireUploader(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const clip = await getClip(id)
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const contentType = request.headers.get("content-type") ?? "video/mp4"
  const contentLength = parseInt(request.headers.get("content-length") ?? "0")
  const offset = parseInt(request.headers.get("x-upload-offset") ?? "0")
  const total = parseInt(request.headers.get("x-upload-total") ?? "0")
  const now = new Date().toISOString()

  try {
    let uploadUrl: string

    if (offset > 0 && clip.uploadSessionUrl) {
      // Resume: reuse existing session
      uploadUrl = clip.uploadSessionUrl
    } else {
      // Fresh upload: create a new session and persist it before streaming
      uploadUrl = await createYouTubeUploadSession({
        title: clip.title ?? `Game Film ${clip.gameId}`,
        contentType,
      })
      await updateClip(id, { uploadSessionUrl: uploadUrl, updatedAt: now })
    }

    const ytHeaders: Record<string, string> = { "Content-Type": contentType }
    if (offset > 0 && total > 0 && contentLength > 0) {
      ytHeaders["Content-Range"] = `bytes ${offset}-${offset + contentLength - 1}/${total}`
    } else if (contentLength > 0) {
      ytHeaders["Content-Length"] = String(contentLength)
    }

    const ytRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: ytHeaders,
      body: request.body,
      // @ts-expect-error - required for streaming request body in Node.js fetch
      duplex: "half",
    })

    if (!ytRes.ok) {
      const text = await ytRes.text().catch(() => "")
      return NextResponse.json(
        { error: `YouTube upload failed (${ytRes.status}): ${text.slice(0, 200)}` },
        { status: 502 }
      )
    }

    const data = await ytRes.json()
    if (!data.id) return NextResponse.json({ error: "YouTube response missing video ID" }, { status: 502 })

    // Clear the session URL now that the upload is complete
    await updateClip(id, { uploadSessionUrl: undefined, updatedAt: now })

    return NextResponse.json({ youtubeVideoId: data.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
