import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { deletePlayerLink } from "@/lib/aws/player-links"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cognitoSub: string }> }
) {
  const { cognitoSub } = await params

  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  try {
    await deletePlayerLink(cognitoSub)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete player link"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
