"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import { Badge } from "@/components/ui/badge"
import type { GameItem, GameStatus } from "@/lib/aws/games"
import type { PlayerItem } from "@/lib/aws/players"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"

const STATUS_VARIANT: Record<GameStatus, "default" | "secondary" | "outline"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "secondary",
  FINAL: "default",
}

const EVENT_TYPE_LABELS: Record<PointEventType, string> = {
  GOAL: "Goal",
  ASSIST: "Assist",
  TURNOVER: "Turnover",
  BLOCK: "Block",
  PULL: "Pull",
}

const EVENT_TYPE_COLORS: Record<PointEventType, string> = {
  GOAL: "text-green-400",
  ASSIST: "text-blue-400",
  TURNOVER: "text-red-400",
  BLOCK: "text-yellow-400",
  PULL: "text-white/50",
}

type PlayerStat = {
  player: PlayerItem
  goals: number
  assists: number
  turnovers: number
  blocks: number
  pulls: number
}

function computePlayerStats(players: PlayerItem[], events: PointEventItem[]): PlayerStat[] {
  const map = new Map<string, PlayerStat>()
  for (const player of players) {
    map.set(player.id, { player, goals: 0, assists: 0, turnovers: 0, blocks: 0, pulls: 0 })
  }
  for (const ev of events) {
    const stat = map.get(ev.playerId)
    if (!stat) continue
    if (ev.eventType === "GOAL") stat.goals++
    else if (ev.eventType === "ASSIST") stat.assists++
    else if (ev.eventType === "TURNOVER") stat.turnovers++
    else if (ev.eventType === "BLOCK") stat.blocks++
    else if (ev.eventType === "PULL") stat.pulls++
  }
  return Array.from(map.values())
    .filter(s => s.goals + s.assists + s.turnovers + s.blocks + s.pulls > 0)
    .sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists))
}

export default function GameDetailPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { eventId, gameId } = useParams<{ eventId: string; gameId: string }>()

  const [game, setGame] = useState<GameItem | null>(null)
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [points, setPoints] = useState<PointItem[]>([])
  const [pointEvents, setPointEvents] = useState<PointEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isLoading && !user) router.replace("/live/login")
  }, [user, isLoading, router])

  useEffect(() => {
    if (!user) return
    Promise.all([
      fetch(`/api/games/${gameId}`),
      fetch("/api/players"),
      fetch(`/api/points?gameId=${gameId}`),
      fetch(`/api/point-events?gameId=${gameId}`),
    ])
      .then(async ([gameRes, playersRes, pointsRes, eventsRes]) => {
        if (!gameRes.ok) { setError("Game not found"); return }
        const [gameData, playersData, pointsData, eventsData] = await Promise.all([
          gameRes.json(), playersRes.json(), pointsRes.json(), eventsRes.json(),
        ])
        setGame(gameData)
        setPlayers(Array.isArray(playersData) ? playersData : [])
        setPoints(Array.isArray(pointsData) ? pointsData.sort((a: PointItem, b: PointItem) => a.pointNumber - b.pointNumber) : [])
        setPointEvents(Array.isArray(eventsData) ? eventsData : [])
      })
      .catch(() => setError("Failed to load game data"))
      .finally(() => setLoading(false))
  }, [user, gameId])

  if (isLoading || !user || loading) {
    return <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /></div>
  }

  if (error || !game) {
    return (
      <div className="flex flex-col p-8 lg:px-16 gap-4">
        <button onClick={() => router.back()} className="text-white/40 hover:text-white/70 text-sm w-fit">← Back</button>
        <p className="text-white/40 text-sm">{error || "Game not found."}</p>
      </div>
    )
  }

  function getPlayerName(id: string) {
    const p = players.find(p => p.id === id)
    return p ? `${p.first_name} ${p.last_name}` : "Unknown"
  }

  const completedPoints = points.filter(p => p.status === "COMPLETE")
  const holds = completedPoints.filter(p => p.outcome === "HOLD").length
  const breaks = completedPoints.filter(p => p.outcome === "BREAK").length
  const oPoints = completedPoints.filter(p => p.lineType === "O")
  const dPoints = completedPoints.filter(p => p.lineType === "D")
  const oEfficiency = oPoints.length > 0
    ? Math.round((oPoints.filter(p => p.outcome === "HOLD").length / oPoints.length) * 100)
    : null
  const dConversion = dPoints.length > 0
    ? Math.round((dPoints.filter(p => p.outcome === "BREAK").length / dPoints.length) * 100)
    : null

  const playerStats = computePlayerStats(players, pointEvents)

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8 text-left max-w-4xl">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push(`/live/events/${eventId}`)}
          className="text-white/40 hover:text-white/70 text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Back to Event
        </button>
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-3xl font-black">vs {game.opponent}</h1>
          <Badge variant={STATUS_VARIANT[game.status]} className="mt-1">{game.status}</Badge>
          {game.result && (
            <span className={`text-sm font-bold mt-1 ${game.result === "WIN" ? "text-green-400" : game.result === "LOSS" ? "text-red-400" : "text-yellow-400"}`}>
              {game.result}
            </span>
          )}
        </div>
        {game.round && <p className="text-white/40 text-sm mt-1">{game.round}</p>}
        <p className="text-white/70 font-mono text-3xl mt-2">{game.scoreVoid} – {game.scoreOpponent}</p>
      </div>

      {/* Quick stats */}
      {completedPoints.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Holds" value={holds} />
          <StatCard label="Breaks" value={breaks} />
          {oEfficiency !== null && <StatCard label="O-efficiency" value={`${oEfficiency}%`} />}
          {dConversion !== null && <StatCard label="D-conversion" value={`${dConversion}%`} />}
        </div>
      )}

      {/* Player stat table */}
      {playerStats.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Player Stats</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/30 text-xs border-b border-white/10">
                  <th className="text-left py-2 pr-4 font-medium">Player</th>
                  <th className="text-right py-2 px-3 font-medium text-green-400/70">G</th>
                  <th className="text-right py-2 px-3 font-medium text-blue-400/70">A</th>
                  <th className="text-right py-2 px-3 font-medium text-red-400/70">T</th>
                  <th className="text-right py-2 px-3 font-medium text-yellow-400/70">B</th>
                  <th className="text-right py-2 px-3 font-medium text-white/40">Pl</th>
                </tr>
              </thead>
              <tbody>
                {playerStats.map(({ player, goals, assists, turnovers, blocks, pulls }) => (
                  <tr key={player.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                    <td className="py-2 pr-4">
                      <span className="text-white/70">{player.first_name} {player.last_name}</span>
                      <span className="text-white/25 text-xs ml-2">#{player.number}</span>
                    </td>
                    <td className="text-right py-2 px-3 text-green-400 font-mono">{goals || "—"}</td>
                    <td className="text-right py-2 px-3 text-blue-400 font-mono">{assists || "—"}</td>
                    <td className="text-right py-2 px-3 text-red-400 font-mono">{turnovers || "—"}</td>
                    <td className="text-right py-2 px-3 text-yellow-400 font-mono">{blocks || "—"}</td>
                    <td className="text-right py-2 px-3 text-white/40 font-mono">{pulls || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-white/20 text-xs mt-2">G = Goals · A = Assists · T = Turnovers · B = Blocks · Pl = Pulls</p>
          </div>
        </section>
      )}

      {/* Point log */}
      {completedPoints.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Point Log</h2>
          <div className="flex flex-col gap-2">
            {completedPoints.map(point => {
              const events = pointEvents
                .filter(e => e.pointId === point.id)
                .sort((a, b) => a.sortOrder - b.sortOrder)
              const lineNames = point.playerIds
                .map(id => players.find(p => p.id === id))
                .filter(Boolean)
                .map(p => p!.first_name)
                .join(", ")

              return (
                <details key={point.id} className="border border-white/10 rounded-lg group">
                  <summary className="flex items-center gap-4 px-4 py-3 cursor-pointer list-none hover:bg-white/3 transition-colors">
                    <span className="text-white/30 font-mono text-xs w-6 text-right">P{point.pointNumber}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      point.outcome === "HOLD" ? "bg-green-400/15 text-green-400" : "bg-red-400/15 text-red-400"
                    }`}>
                      {point.outcome}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${
                      point.lineType === "O" ? "border-blue-400/30 text-blue-400/70" : "border-orange-400/30 text-orange-400/70"
                    }`}>
                      {point.lineType}-line
                    </span>
                    <span className="text-white/30 text-xs truncate flex-1">{lineNames || "—"}</span>
                    <span className="text-white/30 font-mono text-xs shrink-0">
                      {point.voidScoreBefore} – {point.opponentScoreBefore}
                    </span>
                  </summary>
                  {events.length > 0 && (
                    <div className="border-t border-white/5 px-4 py-3 flex flex-col gap-1.5">
                      {events.map((ev, i) => (
                        <div key={ev.id} className="flex items-center gap-3 text-sm">
                          <span className="text-white/20 font-mono text-xs w-4 text-right">{i + 1}</span>
                          <span className={`font-medium ${EVENT_TYPE_COLORS[ev.eventType]}`}>{EVENT_TYPE_LABELS[ev.eventType]}</span>
                          <span className="text-white/60">{getPlayerName(ev.playerId)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-white/10 rounded-lg px-4 py-3">
      <div className="text-2xl font-black font-mono">{value}</div>
      <div className="text-white/40 text-xs mt-0.5">{label}</div>
    </div>
  )
}
