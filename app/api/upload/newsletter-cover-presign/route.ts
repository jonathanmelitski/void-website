import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getPresignedUploadUrl } from "@/lib/aws/s3"

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { newsletterId, contentType = "image/jpeg" } = await request.json()
  if (!newsletterId) {
    return NextResponse.json({ error: "newsletterId is required" }, { status: 400 })
  }
  const ext = EXT[contentType]
  if (!ext) {
    return NextResponse.json({ error: "Use a JPEG, PNG, WebP or GIF image" }, { status: 400 })
  }

  // Versioned key: replacing a cover must never rewrite the image in emails already sent.
  const key = `newsletters/${newsletterId}/cover-${randomUUID()}.${ext}`
  const url = await getPresignedUploadUrl(key, contentType)
  return NextResponse.json({ url, key })
}
