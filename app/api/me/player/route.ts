import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { getPlayerLink } from "@/lib/aws/player-links"
import { getPlayer } from "@/lib/aws/players"

export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { payload } = auth

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
