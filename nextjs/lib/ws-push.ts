import { getGame } from "./aws/games"
import { listPointsByGame } from "./aws/points"
import { listEventsByGame } from "./aws/point-events"
import { listPlayers } from "./aws/players"

const WS_SERVER_URL = process.env.WS_SERVER_URL ?? "http://live.voidultimate.com:3000"

export async function pushGameUpdate(gameId: string): Promise<void> {
  const wsUrl = WS_SERVER_URL
  const secret = process.env.WS_INTERNAL_SECRET
  if (!secret) return

  try {
    const [game, points, pointEvents, players] = await Promise.all([
      getGame(gameId),
      listPointsByGame(gameId),
      listEventsByGame(gameId),
      listPlayers(),
    ])
    if (!game) return

    const payload = JSON.stringify({ game, points, pointEvents, players, ts: Date.now() })
    await fetch(`${wsUrl}/internal/push/${gameId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: payload,
    })
  } catch {
    // Silent fail — WS push is best-effort, not critical
  }
}
