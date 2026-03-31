import type { GameItem } from "./aws/games"
import type { PointItem } from "./aws/points"
import type { PointEventItem } from "./aws/point-events"
import type { PlayerItem } from "./aws/players"

export type LiveGameMessage = {
  game: GameItem
  points: PointItem[]
  pointEvents: PointEventItem[]
  players: PlayerItem[]
  ts: number
}
