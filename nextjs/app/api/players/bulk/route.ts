import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { createPlayer } from "@/lib/aws/players"
import type { PlayerItem } from "@/lib/aws/players"
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

  const { players } = await request.json()
  if (!Array.isArray(players) || players.length === 0) {
    return NextResponse.json({ error: "players array is required" }, { status: 400 })
  }

  const now = new Date().toISOString()
  const added: PlayerItem[] = []
  const failed: { input: string; reason: string }[] = []

  await Promise.all(
    players.map(async (p: Partial<PlayerItem> & { raw?: string }) => {
      const raw = p.raw ?? `${p.first_name} ${p.last_name}`
      try {
        if (!p.first_name || !p.last_name || p.number === undefined || !p.team) {
          failed.push({ input: raw, reason: "Missing required fields" })
          return
        }
        const item: PlayerItem = {
          id: randomUUID(),
          first_name: p.first_name,
          last_name: p.last_name,
          number: p.number,
          team: p.team,
          is_captain: p.is_captain ?? false,
          ...(p.jersey_name_text ? { jersey_name_text: p.jersey_name_text } : {}),
          is_active: p.is_active ?? true,
          createdAt: now,
        }
        await createPlayer(item)
        added.push(item)
      } catch (err) {
        failed.push({ input: raw, reason: err instanceof Error ? err.message : "Failed to create" })
      }
    })
  )

  return NextResponse.json({ added, failed })
}
