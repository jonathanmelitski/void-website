import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listPlayers, createPlayer } from "@/lib/aws/players"
import { randomUUID } from "crypto"

export async function GET() {
  try {
    const players = await listPlayers()
    return NextResponse.json(players)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch players"
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

  const { first_name, last_name, number, team, is_captain, jersey_name_text, is_active } =
    await request.json()

  if (!first_name || !last_name || number === undefined || !team) {
    return NextResponse.json({ error: "first_name, last_name, number, and team are required" }, { status: 400 })
  }

  const item = {
    id: randomUUID(),
    first_name,
    last_name,
    number,
    team,
    is_captain: is_captain ?? false,
    ...(jersey_name_text ? { jersey_name_text } : {}),
    is_active: is_active ?? true,
    createdAt: new Date().toISOString(),
  }

  try {
    await createPlayer(item)
    return NextResponse.json(item, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create player"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
