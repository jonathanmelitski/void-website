import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getPresignedUploadUrl } from "@/lib/aws/s3"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { newsletterId, contentType = "image/jpeg" } = await request.json()
  if (!newsletterId) {
    return NextResponse.json({ error: "newsletterId is required" }, { status: 400 })
  }

  const key = `newsletters/${newsletterId}/cover.jpg`
  const url = await getPresignedUploadUrl(key, contentType)
  return NextResponse.json({ url, key })
}
