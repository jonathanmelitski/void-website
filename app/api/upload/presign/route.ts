import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getPresignedUploadUrl } from "@/lib/aws/s3"

export async function POST(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const { eventId, filename, contentType } = await request.json()
  if (!eventId || !filename || !contentType) {
    return NextResponse.json({ error: "eventId, filename, and contentType are required" }, { status: 400 })
  }

  const key = `events/${eventId}/photos/${filename}`
  const url = await getPresignedUploadUrl(key, contentType)
  return NextResponse.json({ url, key })
}
