import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { deletePlayerLink } from "@/lib/aws/player-links"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ cognitoSub: string }> }
) {
  const { cognitoSub } = await params

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const groups = payload["cognito:groups"] ?? []
  if (!groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    await deletePlayerLink(cognitoSub)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete player link"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
