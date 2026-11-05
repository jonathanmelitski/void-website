import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { listPlayerLinks, createPlayerLink } from "@/lib/aws/player-links"

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  try {
    const links = await listPlayerLinks()
    return NextResponse.json(links)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch player links"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload } = auth

  const { cognitoSub, playerId } = await request.json()
  if (!cognitoSub || !playerId) {
    return NextResponse.json({ error: "cognitoSub and playerId are required" }, { status: 400 })
  }

  const linkedBy = payload["cognito:username"] ?? payload.sub
  const item = { cognitoSub, playerId, linkedBy, linkedAt: new Date().toISOString() }

  try {
    await createPlayerLink(item)
    return NextResponse.json(item, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create player link"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
