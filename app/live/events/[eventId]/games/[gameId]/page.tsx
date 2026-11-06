"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ListX, Radio, Trophy } from "lucide-react"
import { useRequireAuth } from "@/hooks/use-require-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page"
import { formatGameTime } from "@/lib/format-date"
import type { GameItem, GameResult } from "@/lib/aws/games"
import type { PlayerItem } from "@/lib/aws/players"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"
import { deriveGameStats, type DerivedPoint, type GameStats } from "@/lib/stats/derive"

const RESULT_BADGE: Record<GameResult, { label: string; variant: "success" | "destructive" | "warning" }> = {
  WIN: { label: "Win", variant: "success" },
  LOSS: { label: "Loss", variant: "destructive" },
  TIE: { label: "Tie", variant: "warning" },
}

// Point outcome from Void's side: who scored, and whether it was a hold or a break.
function pointLabel(p: DerivedPoint): { text: string; tone: string } {
  if (!p.scorer) return { text: "No result", tone: "bg-surface-2 text-fg-muted" }
  if (p.scorer === "US") return { text: p.lineType === "O" ? "Hold" : "Break", tone: "bg-success/15 text-success" }
  return { text: p.lineType === "O" ? "Broken" : "Conceded", tone: "bg-destructive/15 text-destructive" }
}

const EVENT_TYPE_LABELS: Record<PointEventType, string> = {
  GOAL: "Goal",
  ASSIST: "Assist",
  TURNOVER: "Turnover",
  BLOCK: "Block",
  PULL: "Pull",
  PULL_FINISHED: "Pull landed",
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
  const { eventId, gameId } = useParams<{ eventId: string; gameId: string }>()

  const [game, setGame] = useState<GameItem | null>(null)
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [points, setPoints] = useState<PointItem[]>([])
  const [pointEvents, setPointEvents] = useState<PointEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Game data is public, so it loads alongside the auth check rather than after it.
  useEffect(() => {
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
      .catch(() => setError("Couldn't load this game. Check your connection and reload the page."))
      .finally(() => setLoading(false))
  }, [gameId])

  useEffect(() => {
    if (game) document.title = `Void vs ${game.opponent} · Void Live`
  }, [game])

  const backLink = (
    <Link href={`/live/events/${eventId}`} className="inline-flex min-h-10 items-center gap-1 text-sm text-fg-muted hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden />
      Back to event
    </Link>
  )

  if (isLoading || !user || loading) return <GameSkeleton />

  if (error || !game) {
    return (
      <PageContainer width="prose">
        {backLink}
        <EmptyState
          variant="page"
          icon={<Trophy />}
          title={error === "Game not found" || !error ? "Game not found" : "Couldn't load this game"}
          description={error === "Game not found" || !error ? "It may have been removed." : "Check your connection and reload the page."}
        />
      </PageContainer>
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
  const isLive = game.status === "IN_PROGRESS"
  // Stored status can stay SCHEDULED for games scored only in film; the points are the truth then.
  const notStarted = game.status === "SCHEDULED" && stats.points.length === 0
  const startTime = formatGameTime(game.scheduledTime)

  const playerStats = toPlayerStats(stats, players)

  return (
    <PageContainer width="prose" className="flex flex-col gap-8 text-left">
      {/* Header */}
      <header className="flex flex-col gap-3">
        {backLink}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-display leading-none tracking-wide md:text-5xl">Void vs {game.opponent}</h1>
          {isLive ? (
            <Badge variant="destructive">Live</Badge>
          ) : notStarted ? (
            <Badge variant="outline">Scheduled</Badge>
          ) : result ? (
            <Badge variant={RESULT_BADGE[result].variant}>{RESULT_BADGE[result].label}</Badge>
          ) : null}
        </div>
        {(game.round || (notStarted && startTime)) && (
          <p className="text-fg-muted text-sm">{[game.round, notStarted ? startTime : null].filter(Boolean).join(" · ")}</p>
        )}
        {!notStarted && (
          <p className="font-mono tabular-nums text-4xl text-foreground">{stats.score.us}–{stats.score.them}</p>
        )}
        {isLive && (
          <Button asChild variant="brand" size="lg" className="w-fit">
            <Link href={`/live/watch/${game.id}`}><Radio aria-hidden />Watch live</Link>
          </Button>
        )}
        {isCoachOrAdmin && stats.warnings.length > 0 && (
          <ul className="text-fg-muted text-xs mt-2 flex flex-col gap-0.5" aria-label="Data warnings">
            {stats.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        )}
      </header>

      {stats.points.length === 0 && (
        <EmptyState
          icon={<ListX />}
          title={notStarted ? "This game hasn't started" : "No points recorded"}
          description={notStarted ? "Stats and the point log appear here once points are scored." : "No points were recorded for this game."}
        />
      )}

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
          <h2 className="text-lg font-semibold mb-3">Player stats</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg-muted text-xs border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium">Player</th>
                  {STAT_COLUMNS.map(([short, long]) => (
                    <th key={short} className="text-right py-2 px-2 sm:px-3 font-medium">
                      <abbr title={long} className="no-underline sm:hidden">{short}</abbr>
                      <span className="hidden sm:inline">{long}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {playerStats.map(({ player, goals, assists, turnovers, blocks, pulls }) => (
                  <tr key={player.id} className="border-b border-border hover:bg-surface-2 transition-colors">
                    <td className="py-2 pr-4">
                      <span className="text-foreground">{player.first_name} {player.last_name}</span>
                      {player.number != null && <span className="text-fg-muted text-xs ml-2">#{player.number}</span>}
                    </td>
                    {[goals, assists, turnovers, blocks, pulls].map((n, i) => (
                      <td key={i} className={`text-right py-2 px-2 sm:px-3 font-mono tabular-nums ${n ? "text-foreground" : "text-fg-faint"}`}>{n || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-fg-muted text-xs mt-2 sm:hidden">G goals · A assists · T turnovers · B blocks · Pl pulls</p>
          </div>
        </section>
      )}

      {/* Point log */}
      {stats.points.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Point log</h2>
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

              const label = pointLabel(point)
              return (
                <details key={point.id} className="border border-border rounded-xl group">
                  <summary className="flex items-center gap-4 px-4 py-3 cursor-pointer list-none hover:bg-surface-2 transition-colors">
                    <span className="text-fg-muted font-mono tabular-nums text-xs w-7 text-right shrink-0">P{point.pointNumber}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md shrink-0 w-[4.5rem] text-center ${label.tone}`}>
                      {label.text}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-md border border-border text-fg-secondary whitespace-nowrap shrink-0">
                      {point.lineType}-line
                    </span>
                    <span className="text-fg-muted text-xs truncate flex-1">{lineNames || "—"}</span>
                    <span className="text-foreground font-mono tabular-nums text-xs shrink-0" title="Score after the point">
                      {point.scoreAfter.us}–{point.scoreAfter.them}
                    </span>
                  </summary>
                  {events.length > 0 && (
                    <div className="border-t border-border px-4 py-3 flex flex-col gap-1.5">
                      {events.map((ev, i) => (
                        <div key={ev.id} className="flex items-center gap-3 text-sm">
                          <span className="text-fg-muted font-mono text-xs w-4 text-right">{i + 1}</span>
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
    </PageContainer>
  )
}

const STAT_COLUMNS: [string, string][] = [["G", "Goals"], ["A", "Assists"], ["T", "Turnovers"], ["B", "Blocks"], ["Pl", "Pulls"]]

function GameSkeleton() {
  return (
    <PageContainer width="prose" className="flex flex-col gap-8" aria-busy aria-label="Loading game">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-10 w-72 max-w-full md:h-12" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[4.5rem] rounded-xl" />)}
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map(i => <SkeletonRow key={i} />)}
      </div>
    </PageContainer>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border rounded-xl px-4 py-3">
      <div className="text-2xl font-semibold font-mono tabular-nums">{value}</div>
      <div className="text-fg-muted text-xs mt-0.5">{label}</div>
    </div>
  )
}
