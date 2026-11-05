"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useRequireAuth } from "@/hooks/use-require-auth"
import { Badge } from "@/components/ui/badge"
import type { GameItem, GameStatus } from "@/lib/aws/games"
import type { PlayerItem } from "@/lib/aws/players"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"
import { deriveGameStats, type GameStats } from "@/lib/stats/derive"
import { Spinner } from "@/components/ui/spinner"

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
  PULL_FINISHED: "Pull Finished",
  SUBSTITUTION: "Sub",
  TIMEOUT: "Timeout",
}

const EVENT_TYPE_COLORS: Record<PointEventType, string> = {
  GOAL: "text-success",
  ASSIST: "text-brand-text",
  TURNOVER: "text-destructive",
  BLOCK: "text-warning",
  PULL: "text-fg-muted",
  PULL_FINISHED: "text-brand-text",
  SUBSTITUTION: "text-brand-text",
  TIMEOUT: "text-warning",
}

type PlayerStat = {
  player: PlayerItem
  goals: number
  assists: number
  turnovers: number
  blocks: number
  pulls: number
}

// Roster players with at least one counted event, from the derived stats
function toPlayerStats(stats: GameStats, players: PlayerItem[]): PlayerStat[] {
  const byId = new Map(players.map(p => [p.id, p]))
  return stats.players
    .flatMap(s => {
      const player = byId.get(s.playerId)
      return player ? [{ player, goals: s.goals, assists: s.assists, turnovers: s.turnovers, blocks: s.blocks, pulls: s.pulls }] : []
    })
    .filter(s => s.goals + s.assists + s.turnovers + s.blocks + s.pulls > 0)
}

export default function GameDetailPage() {
  const { user, isLoading } = useRequireAuth()
  const router = useRouter()
  const { eventId, gameId } = useParams<{ eventId: string; gameId: string }>()

  const [game, setGame] = useState<GameItem | null>(null)
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [points, setPoints] = useState<PointItem[]>([])
  const [pointEvents, setPointEvents] = useState<PointEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

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
    return <div className="flex items-center justify-center min-h-[50dvh]"><Spinner size="md" /></div>
  }

  if (error || !game) {
    return (
      <div className="flex flex-col p-8 lg:px-16 gap-4">
        <button onClick={() => router.back()} className="text-fg-muted hover:text-foreground text-sm w-fit">← Back</button>
        <p className="text-fg-muted text-sm">{error || "Game not found."}</p>
      </div>
    )
  }

  function getPlayerName(id: string) {

    if (!id) return ""
    const p = players.find(p => p.id === id)
    return p ? `${p.first_name} ${p.last_name}` : "Unknown"
  }

  // Score, outcomes and stats derived from the point record (film point-events win over stored outcomes)
  const stats = deriveGameStats(game, points, pointEvents, players)
  const pointsById = new Map(points.map(p => [p.id, p]))
  const scoredPoints = stats.points.filter(p => p.scorer)
  const { holds, breaks } = stats.team.us
  const { oEfficiency, dConversion } = stats
  const result = stats.result
  const isCoachOrAdmin = !!(user.groups?.includes("COACH") || user.groups?.includes("ADMIN"))

  const playerStats = toPlayerStats(stats, players)

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8 text-left max-w-4xl">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push(`/live/events/${eventId}`)}
          className="text-fg-muted hover:text-foreground text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Back to Event
        </button>
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-3xl font-display leading-none tracking-wide">vs {game.opponent}</h1>
          <Badge variant={STATUS_VARIANT[game.status]} className="mt-1">{game.status}</Badge>
          {result && (
            <span className={`text-sm font-bold mt-1 ${result === "WIN" ? "text-success" : result === "LOSS" ? "text-destructive" : "text-warning"}`}>
              {result}
            </span>
          )}
        </div>
        {game.round && <p className="text-fg-muted text-sm mt-1">{game.round}</p>}
        <p className="text-fg-secondary font-mono tabular-nums text-3xl mt-2">{stats.score.us} – {stats.score.them}</p>
        {isCoachOrAdmin && stats.warnings.length > 0 && (
          <ul className="text-fg-muted text-xs mt-2 flex flex-col gap-0.5" aria-label="Data warnings">
            {stats.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        )}
      </div>

      {/* Quick stats */}
      {scoredPoints.length > 0 && (
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
                <tr className="text-fg-muted text-xs border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium">Player</th>
                  <th className="text-right py-2 px-3 font-medium text-success/70">G</th>
                  <th className="text-right py-2 px-3 font-medium text-brand-text/70">A</th>
                  <th className="text-right py-2 px-3 font-medium text-destructive/70">T</th>
                  <th className="text-right py-2 px-3 font-medium text-warning/70">B</th>
                  <th className="text-right py-2 px-3 font-medium text-fg-muted">Pl</th>
                </tr>
              </thead>
              <tbody>
                {playerStats.map(({ player, goals, assists, turnovers, blocks, pulls }) => (
                  <tr key={player.id} className="border-b border-border hover:bg-surface-2 transition-colors">
                    <td className="py-2 pr-4">
                      <span className="text-fg-secondary">{player.first_name} {player.last_name}</span>
                      <span className="text-fg-faint text-xs ml-2">#{player.number}</span>
                    </td>
                    <td className="text-right py-2 px-3 text-success font-mono">{goals || "—"}</td>
                    <td className="text-right py-2 px-3 text-brand-text font-mono">{assists || "—"}</td>
                    <td className="text-right py-2 px-3 text-destructive font-mono">{turnovers || "—"}</td>
                    <td className="text-right py-2 px-3 text-warning font-mono">{blocks || "—"}</td>
                    <td className="text-right py-2 px-3 text-fg-muted font-mono">{pulls || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-fg-faint text-xs mt-2">G = Goals · A = Assists · T = Turnovers · B = Blocks · Pl = Pulls</p>
          </div>
        </section>
      )}

      {/* Point log */}
      {stats.points.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Point Log</h2>
          <div className="flex flex-col gap-2">
            {stats.points.map(point => {
              const stored = pointsById.get(point.id)
              const events = pointEvents
                .filter(e => e.pointId === point.id)
                .sort((a, b) => a.sortOrder - b.sortOrder)
              const lineNames = (stored?.playerIds ?? [])
                .map(id => players.find(p => p.id === id))
                .filter(Boolean)
                .map(p => p!.first_name)
                .join(", ")

              return (
                <details key={point.id} className="border border-border rounded-xl group">
                  <summary className="flex items-center gap-4 px-4 py-3 cursor-pointer list-none hover:bg-surface-2 transition-colors">
                    <span className="text-fg-muted font-mono text-xs w-6 text-right">P{point.pointNumber}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${
                      point.outcome === "HOLD" ? "bg-success/15 text-success" : point.outcome === "BREAK" ? "bg-destructive/15 text-destructive" : "bg-surface-2 text-fg-muted"
                    }`}>
                      {point.outcome ?? "No result"}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-md border ${
                      point.lineType === "O" ? "border-brand/30 text-brand-text/70" : "border-warning/30 text-warning/70"
                    }`}>
                      {point.lineType}-line
                    </span>
                    <span className="text-fg-muted text-xs truncate flex-1">{lineNames || "—"}</span>
                    <span className="text-fg-muted font-mono text-xs shrink-0">
                      {point.scoreBefore.us} – {point.scoreBefore.them}
                    </span>
                  </summary>
                  {events.length > 0 && (
                    <div className="border-t border-border px-4 py-3 flex flex-col gap-1.5">
                      {events.map((ev, i) => (
                        <div key={ev.id} className="flex items-center gap-3 text-sm">
                          <span className="text-fg-faint font-mono text-xs w-4 text-right">{i + 1}</span>
                          <span className={`font-medium ${EVENT_TYPE_COLORS[ev.eventType]}`}>{EVENT_TYPE_LABELS[ev.eventType]}</span>
                          <span className="text-fg-secondary">{getPlayerName(ev.playerId)}</span>
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
    <div className="border border-border rounded-xl px-4 py-3">
      <div className="text-2xl font-bold font-mono">{value}</div>
      <div className="text-fg-muted text-xs mt-0.5">{label}</div>
    </div>
  )
}
