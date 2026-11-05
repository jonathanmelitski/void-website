import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { listPlayers, createPlayer } from "@/lib/aws/players"
import { publicReadHeaders } from "@/lib/http-cache"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  try {
    const players = await listPlayers()
    // Public roster: short anonymous browser cache; signed-in (editors) always get fresh data
    return NextResponse.json(players, { headers: publicReadHeaders(request, { maxAge: 60, swr: 600 }) })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch players"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

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
