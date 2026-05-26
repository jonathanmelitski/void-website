import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getPlayerLink } from "@/lib/aws/player-links"
import { getPlayer } from "@/lib/aws/players"

export async function GET(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  try {
    const link = await getPlayerLink(payload.sub)
    if (!link) return NextResponse.json({ link: null, player: null, cognitoSub: payload.sub })

    const player = await getPlayer(link.playerId)
    return NextResponse.json({ link, player, cognitoSub: payload.sub })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch player"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
