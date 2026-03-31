import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getPresignedUploadUrl } from "@/lib/aws/s3"
import { randomUUID } from "crypto"

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

  const { contentType = "image/jpeg" } = await request.json()

  const key = `newsletters/images/${randomUUID()}.jpg`
  const url = await getPresignedUploadUrl(key, contentType)
  const publicUrl = `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${key}`
  return NextResponse.json({ url, publicUrl })
}
