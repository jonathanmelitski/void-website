import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { updateClip } from "@/lib/aws/film-clips"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { permission: "film.manage" })
  if (!auth.ok) return auth.response

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
