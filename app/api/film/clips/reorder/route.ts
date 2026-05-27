import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { updateClip } from "@/lib/aws/film-clips"

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

  const body = await request.json()
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: "Body must be a non-empty array of { id, sortOrder }" }, { status: 400 })
  }

  const now = new Date().toISOString()
  await Promise.all(
    (body as { id: string; sortOrder: number }[]).map(({ id, sortOrder }) =>
      updateClip(id, { sortOrder, updatedAt: now })
    )
  )

  return NextResponse.json({ ok: true })
}
