import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { getPresignedUploadUrl } from "@/lib/aws/s3"
import { randomUUID } from "crypto"

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { permission: "newsletters.edit" })
  if (!auth.ok) return auth.response

  const { contentType = "image/jpeg" } = await request.json()
  const ext = EXT[contentType]
  if (!ext) {
    return NextResponse.json({ error: "Use a JPEG, PNG, WebP or GIF image" }, { status: 400 })
  }

  const key = `newsletters/images/${randomUUID()}.${ext}`
  const url = await getPresignedUploadUrl(key, contentType)
  const publicUrl = `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${key}`
  return NextResponse.json({ url, publicUrl })
}
