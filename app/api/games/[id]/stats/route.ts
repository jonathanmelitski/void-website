import { NextRequest, NextResponse } from "next/server"
import { loadGameStats } from "@/lib/stats/load"
import { canViewEvent, getCaller, isCoach } from "@/lib/event-access"
import { isTestGame } from "@/lib/test-games"

interface Props {
  params: Promise<{ id: string }>
}

// Derived score, team and player stats for one game. Read-only.
// Games of private events are hidden (404) from callers who can't see the event.
// Data-quality warnings are only returned to coaches/admins.
export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const [loaded, caller] = await Promise.all([loadGameStats(id), getCaller(request)])
    // A game whose event no longer exists has no privacy flag to enforce
    if (!loaded || (loaded.event && !canViewEvent(loaded.event, caller)) || (isTestGame(loaded.game) && !isCoach(caller))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const { stats } = loaded
    return NextResponse.json(isCoach(caller) ? stats : { ...stats, warnings: [] })
  } catch (err: unknown) {
    console.error("GET /api/games/[id]/stats failed", err)
    return NextResponse.json({ error: "Failed to load game stats" }, { status: 500 })
  }
}
