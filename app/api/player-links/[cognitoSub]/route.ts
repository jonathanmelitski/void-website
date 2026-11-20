import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { deletePlayerLink } from "@/lib/aws/player-links"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cognitoSub: string }> }
) {
  const { cognitoSub } = await params

  const auth = await requireUser(request, { permission: "playerLinks.manage" })
  if (!auth.ok) return auth.response

  try {
    await deletePlayerLink(cognitoSub)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete player link"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
