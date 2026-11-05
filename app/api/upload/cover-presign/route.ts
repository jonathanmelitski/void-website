import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getPresignedUploadUrl } from "@/lib/aws/s3"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { eventId, contentType = "image/jpeg" } = await request.json()
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 })
  }

  const key = `events/${eventId}/cover.jpg`
  const url = await getPresignedUploadUrl(key, contentType)
  return NextResponse.json({ url, key })
}
