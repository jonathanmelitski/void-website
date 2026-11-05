import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getPresignedUploadUrl } from "@/lib/aws/s3"
import { randomUUID } from "crypto"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { contentType = "image/jpeg" } = await request.json()

  const key = `newsletters/images/${randomUUID()}.jpg`
  const url = await getPresignedUploadUrl(key, contentType)
  const publicUrl = `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${key}`
  return NextResponse.json({ url, publicUrl })
}
