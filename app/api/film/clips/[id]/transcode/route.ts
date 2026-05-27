import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getClip, updateClip } from "@/lib/aws/film-clips"
import { createMediaConvertJob } from "@/lib/aws/mediaconvert"

export async function POST(
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

  const clip = await getClip(id)
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const rawKey: string | undefined = body.s3RawKey ?? clip.s3RawKey
  if (!rawKey) return NextResponse.json({ error: "s3RawKey is required" }, { status: 400 })

  try {
    const mediaConvertJobId = await createMediaConvertJob({
      s3RawKey: rawKey,
      outputPrefix: `hls/${id}/`,
      title: clip.title ?? id,
    })

    const now = new Date().toISOString()
    await updateClip(id, {
      status: "TRANSCODING",
      mediaConvertJobId,
      s3RawKey: rawKey,
      updatedAt: now,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start transcoding"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
