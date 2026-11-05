import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { getPresignedUploadUrl } from "@/lib/aws/s3"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response

  const { eventId, filename, contentType } = await request.json()
  if (!eventId || !filename || !contentType) {
    return NextResponse.json({ error: "eventId, filename, and contentType are required" }, { status: 400 })
  }

  const key = `events/${eventId}/photos/${filename}`
  const url = await getPresignedUploadUrl(key, contentType)
  return NextResponse.json({ url, key })
}
