import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getPresignedUploadUrl } from "@/lib/aws/s3"

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

  const { eventId, contentType = "image/jpeg" } = await request.json()
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 })
  }

  const key = `events/${eventId}/cover.jpg`
  const url = await getPresignedUploadUrl(key, contentType)
  return NextResponse.json({ url, key })
}
