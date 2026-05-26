import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listPlayerLinks, createPlayerLink } from "@/lib/aws/player-links"

export async function GET(request: NextRequest) {
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

  try {
    const links = await listPlayerLinks()
    return NextResponse.json(links)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch player links"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

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
