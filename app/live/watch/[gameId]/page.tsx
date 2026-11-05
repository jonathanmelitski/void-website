"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import type { GameItem } from "@/lib/aws/games"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"
import type { PlayerItem } from "@/lib/aws/players"
import type { LiveGameMessage } from "@/lib/live-types"
import { deriveGameStats, displayScore } from "@/lib/stats/derive"
import { formatGameTime } from "@/lib/format-date"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Radio } from "lucide-react"

// --- Connection status ---
type ConnStatus = "connecting" | "connected" | "reconnecting" | "polling" | "final"

// --- Possession state ---
type Possession = "VOID" | "OPP"

const EVENT_LABELS: Record<PointEventType, string> = {
  GOAL: "Goal",
  ASSIST: "Assist",
  TURNOVER: "Turnover",
  BLOCK: "Block",
  PULL: "Pull",
  PULL_FINISHED: "Pull landed",
  SUBSTITUTION: "Sub",
  TIMEOUT: "Timeout",
}

const EVENT_COLORS: Record<PointEventType, string> = {
  GOAL: "text-success",
  ASSIST: "text-brand-text",
  TURNOVER: "text-destructive",
  BLOCK: "text-warning",
  PULL: "text-fg-muted",
  PULL_FINISHED: "text-brand-text",
  SUBSTITUTION: "text-brand-text",
  TIMEOUT: "text-warning",
}

// Possession is determined by line type at the start of the point
// O-line = VOID received the pull = VOID on offense
// D-line = VOID pulled = VOID on defense
function inferPossession(point: PointItem | null): Possession {
  if (!point) return "VOID"
  return point.lineType === "O" ? "VOID" : "OPP"
}

export default function LiveWatchPage() {
  const { gameId } = useParams<{ gameId: string }>()

  const [game, setGame] = useState<GameItem | null>(null)
  const [points, setPoints] = useState<PointItem[]>([])
  const [pointEvents, setPointEvents] = useState<PointEventItem[]>([])
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [connStatus, setConnStatus] = useState<ConnStatus>("connecting")
  const [notFound, setNotFound] = useState(false)
  const [flashEZ, setFlashEZ] = useState<"LEFT" | "RIGHT" | null>(null)
  const [scorePulse, setScorePulse] = useState<"VOID" | "OPP" | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const unmountedRef = useRef(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevScoreRef = useRef<{ void: number; opp: number } | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function getPlayerName(id: string) {

    if (!id) return ""
    const p = players.find(p => p.id === id)
    return p ? `${p.first_name} ${p.last_name}` : "Unknown"
  }

  const applyUpdate = useCallback((data: LiveGameMessage) => {
    const prev = prevScoreRef.current

    // Detect score change for flash animation — flash the attacking end zone
    if (prev) {
      const completedCount = data.points.filter(p => p.status === "COMPLETE").length
      if (data.game.scoreVoid > prev.void || data.game.scoreOpponent > prev.opp) {
        const isSecondHalf = data.game.secondHalfStartCompletedCount !== undefined
        const halfStartCount = data.game.secondHalfStartCompletedCount ?? 0
        // The point that just completed was the last completed point (index completedCount - 1)
        const pointsInHalfBeforeScore = isSecondHalf
          ? (completedCount - 1) - halfStartCount
          : (completedCount - 1)
        const receivingThisHalf = isSecondHalf ? !data.game.voidReceivingFirst : data.game.voidReceivingFirst
        const wasAttackingRight = (pointsInHalfBeforeScore % 2 === 0) === receivingThisHalf
        if (data.game.scoreVoid > prev.void) {
          triggerFlash(wasAttackingRight ? "RIGHT" : "LEFT", "VOID")
        } else {
          // opponent attacks opposite direction
          triggerFlash(wasAttackingRight ? "LEFT" : "RIGHT", "OPP")
        }
      }
    }

    prevScoreRef.current = { void: data.game.scoreVoid, opp: data.game.scoreOpponent }

    setGame(data.game)
    setPoints(data.points)
    setPointEvents(data.pointEvents)
    setPlayers(data.players)

    if (data.game.status === "FINAL") {
      setConnStatus("final")
      stopPolling()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function triggerFlash(side: "LEFT" | "RIGHT", team: "VOID" | "OPP") {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    setFlashEZ(side)
    setScorePulse(team)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashEZ(null)
      setScorePulse(null)
    }, 2000)
  }

  // --- HTTP polling fallback ---
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return

    async function poll() {
      try {
        const [gameRes, pointsRes, eventsRes, playersRes] = await Promise.all([
          fetch(`/api/games/${gameId}`),
          fetch(`/api/points?gameId=${gameId}`),
          fetch(`/api/point-events?gameId=${gameId}`),
          fetch("/api/players"),
        ])
        if (!gameRes.ok) {
          if (gameRes.status === 404) setNotFound(true)
          return
        }
        const [gameData, pointsData, eventsData, playersData] = await Promise.all([
          gameRes.json(), pointsRes.json(), eventsRes.json(), playersRes.json(),
        ])
        applyUpdate({
          game: gameData,
          points: Array.isArray(pointsData) ? pointsData : [],
          pointEvents: Array.isArray(eventsData) ? eventsData : [],
          players: Array.isArray(playersData) ? playersData : [],
          ts: Date.now(),
        })
      } catch { /* ignore */ }
    }

    poll()
    pollIntervalRef.current = setInterval(poll, 4_000)
  }, [gameId, applyUpdate])

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  // --- WebSocket connection with full lifecycle management ---
  const connect = useCallback(() => {
    if (unmountedRef.current) return

    setConnStatus(attemptsRef.current === 0 ? "connecting" : "reconnecting")

    // Give up on the socket after 3 consecutive failures; polling (already running) keeps the page current
    if (attemptsRef.current >= 3) {
      setConnStatus("polling")
      startPolling()
      return
    }

    try {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:"
      const wsHost = process.env.NEXT_PUBLIC_WS_HOST ?? location.host
      const ws = new WebSocket(`${protocol}//${wsHost}/ws/game/${gameId}`)
      wsRef.current = ws

      ws.onopen = () => {
        attemptsRef.current = 0
        setConnStatus("connected")
        // Live pushes take over from polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
      }

      ws.onmessage = e => {
        try {
          applyUpdate(JSON.parse(e.data) as LiveGameMessage)
        } catch { /* ignore malformed messages */ }
      }

      ws.onclose = e => {
        wsRef.current = null
        if (e.code === 1000) {
          // Clean close: game over or intentional unmount — do NOT reconnect
          return
        }
        if (unmountedRef.current) return
        setConnStatus("reconnecting")
        // Keep the score moving over HTTP while the socket is down
        startPolling()
        const delay = Math.min(1_000 * Math.pow(2, attemptsRef.current++), 30_000)
        reconnectRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        // onclose will fire after onerror and handle retry
        ws.close()
      }
    } catch {
      // WebSocket constructor can throw if URL is invalid
      attemptsRef.current++
      startPolling()
    }
  }, [gameId, applyUpdate, startPolling])

  useEffect(() => {
    unmountedRef.current = false
    // Load the game over HTTP straight away; don't wait for socket retries (the WS server may be unreachable)
    startPolling()
    connect()

    return () => {
      unmountedRef.current = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
      stopPolling()
      if (wsRef.current) {
        wsRef.current.close(1000) // clean close — server will not push reconnect
        wsRef.current = null
      }
    }
  }, [connect, startPolling])

  // --- Derived state ---

  const activePoint = points.find(p => p.status === "IN_PROGRESS") ?? null
  const completedPoints = points
    .filter(p => p.status === "COMPLETE")
    .sort((a, b) => a.pointNumber - b.pointNumber)
  // Score shown: the live push while IN_PROGRESS, else derived from the point record (film edits included)
  const stats = game ? deriveGameStats(game, points, pointEvents, players) : null
  const shown = game && stats ? displayScore(game, stats) : null
  const shownResult = shown ? shown.result : game?.result
  const pointChips = shown?.derived && stats
    ? stats.points.filter(p => p.scorer).map(p => ({ id: p.id, pointNumber: p.pointNumber, lineType: p.lineType, outcome: p.outcome, voidScored: p.scorer === "US" }))
    : completedPoints.map(p => ({
        id: p.id, pointNumber: p.pointNumber, lineType: p.lineType, outcome: p.outcome,
        voidScored: (p.outcome === "HOLD" && p.lineType === "O") || (p.outcome === "BREAK" && p.lineType === "D"),
      }))
  // Field direction: teams switch ends after every point.
  // At halftime the direction resets from the opposite starting end (whoever pulled now receives).
  // secondHalfStartCompletedCount marks when half was called; direction resets from !voidReceivingFirst.
  const voidAttacksRight = (() => {
    if (!game) return true
    const isSecondHalf = game.secondHalfStartCompletedCount !== undefined
    const pointsThisHalf = isSecondHalf
      ? completedPoints.length - game.secondHalfStartCompletedCount!
      : completedPoints.length
    // Second half receiving team is whoever PULLED in the first half (opposite of voidReceivingFirst)
    const receivingThisHalf = isSecondHalf ? !game.voidReceivingFirst : game.voidReceivingFirst
    return (pointsThisHalf % 2 === 0) === receivingThisHalf
  })()
  const derivedById = new Map((stats?.points ?? []).map(p => [p.id, p]))
  const playByPlay = [...points]
    .sort((a, b) => b.pointNumber - a.pointNumber)
    .map(point => ({
      point,
      events: pointEvents
        .filter(e => e.pointId === point.id && e.eventType !== "PULL_FINISHED")
        .sort((a, b) => b.sortOrder - a.sortOrder),
    }))
    .filter(g => g.events.length > 0)
    .slice(0, 8)
  const possession = inferPossession(activePoint)
  const activeLinePlayers = activePoint
    ? activePoint.playerIds
        .map(id => players.find(p => p.id === id))
        .filter(Boolean) as PlayerItem[]
    : []

  if (!game && notFound) {
    return (
      <EmptyState
        variant="page"
        icon={<Radio />}
        title="Game not found"
        description="Check the link. The game may have been removed."
      />
    )
  }

  if (!game) return <WatchSkeleton />

  // Status comes from the game, not the connection. A game scored only in film can still be stored as
  // SCHEDULED; once it has points, don't call it scheduled.
  const isLive = game.status === "IN_PROGRESS"
  const isFinal = game.status === "FINAL"
  const hasPoints = points.length > 0
  const startTime = formatGameTime(game.scheduledTime)
  const scoreUs = shown?.score.us ?? game.scoreVoid
  const scoreThem = shown?.score.them ?? game.scoreOpponent
  const resultLine = shownResult === "WIN" ? `Void wins ${scoreUs}–${scoreThem}`
    : shownResult === "LOSS" ? `${game.opponent} wins ${scoreThem}–${scoreUs}`
    : shownResult === "TIE" ? `Tied ${scoreUs}–${scoreThem}` : null

  return (
    <div className="flex flex-col gap-0 text-left max-w-3xl mx-auto px-4 sm:px-6 py-6 w-full">

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {isLive ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
              </span>
              Live
            </span>
          ) : isFinal ? (
            <span className="text-xs font-medium text-fg-secondary">Final</span>
          ) : !hasPoints ? (
            <span className="text-xs font-medium text-fg-muted">Scheduled{startTime ? ` · ${startTime}` : ""}</span>
          ) : null}
          <h1 className="text-sm font-medium text-foreground">Void vs {game.opponent}</h1>
          {game.round && <span className="text-fg-muted text-xs">{game.round}</span>}
        </div>
        <span className="text-fg-muted text-xs">
          {isLive && connStatus === "reconnecting" ? "Reconnecting…" : `Game to ${game.cap}`}
        </span>
      </div>

      {/* Score */}
      <div className="flex items-center justify-center gap-8 pt-4 pb-2">
        <div className="flex flex-col items-center gap-1">
          <span className="text-fg-muted text-xs font-medium">Void</span>
          <span className={`text-7xl font-bold font-mono tabular-nums transition-transform duration-300 motion-reduce:transition-none ${scorePulse === "VOID" ? "scale-125 text-success" : "text-foreground"}`}>
            {scoreUs}
          </span>
        </div>
        <span className="text-fg-muted text-3xl font-thin" aria-hidden>–</span>
        <div className="flex flex-col items-center gap-1">
          <span className="text-fg-muted text-xs font-medium max-w-32 truncate">{game.opponent}</span>
          <span className={`text-7xl font-bold font-mono tabular-nums transition-transform duration-300 motion-reduce:transition-none text-foreground ${scorePulse === "OPP" ? "scale-125" : ""}`}>
            {scoreThem}
          </span>
        </div>
      </div>
      <p className="text-center text-sm text-fg-secondary mb-4 min-h-5">
        {(isFinal || (!isLive && hasPoints)) && resultLine ? `${isFinal ? "Final · " : ""}${resultLine}` : ""}
      </p>

      {/* Field (only while the game can still be played) */}
      {!isFinal && <FieldView
        opponent={game.opponent}
        possession={possession}
        voidAttacksRight={voidAttacksRight}
        flashEZ={game.status !== "FINAL" ? flashEZ : null}
        linePlayers={activeLinePlayers}
        isActive={game.status === "IN_PROGRESS" && !!activePoint}
      />}

      {/* Active point info */}
      {activePoint && (
        <div className="flex items-center gap-2 mt-3 px-1 text-xs text-fg-muted">
          <span>P{activePoint.pointNumber}</span>
          <span>·</span>
          <span className={`whitespace-nowrap shrink-0 ${activePoint.lineType === "O" ? "text-brand-text" : "text-warning"}`}>
            {activePoint.lineType}-line
          </span>
          {activeLinePlayers.length > 0 && (
            <>
              <span>·</span>
              <span className="truncate">{activeLinePlayers.map(p => p.first_name).join(", ")}</span>
            </>
          )}
        </div>
      )}

      {/* Play by play: latest point first, events within a point newest first */}
      {playByPlay.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Play by play</h2>
          <div className="flex flex-col gap-4">
            {playByPlay.map(({ point, events }) => {
              const d = derivedById.get(point.id)
              const score = point.status === "IN_PROGRESS" || !d ? d?.scoreBefore : d.scoreAfter
              return (
                <div key={point.id} className="rounded-xl border border-border">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs text-fg-muted">
                    <span>
                      Point {point.pointNumber} · {point.lineType}-line
                      {point.status === "IN_PROGRESS" && <span className="text-destructive"> · Now</span>}
                    </span>
                    {score && <span className="font-mono tabular-nums text-fg-secondary">{score.us}–{score.them}</span>}
                  </div>
                  <ul className="flex flex-col py-1">
                    {events.map(ev => (
                      <li key={ev.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                        <span className={`w-20 shrink-0 font-medium ${EVENT_COLORS[ev.eventType]}`}>
                          {EVENT_LABELS[ev.eventType]}
                        </span>
                        <span className="text-fg-secondary truncate">
                          {ev.eventType === "TIMEOUT"
                            ? (ev.team === "VOID" ? "Void" : game.opponent)
                            : ev.eventType === "SUBSTITUTION"
                              ? `${getPlayerName(ev.playerId)} → ${ev.playerInId ? getPlayerName(ev.playerInId) : "?"}`
                              : getPlayerName(ev.playerId)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Completed points summary */}
      {pointChips.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Points</h2>
          <div className="flex flex-wrap gap-1.5">
            {pointChips.map(point => {
              const { voidScored } = point
              return (
                <span
                  key={point.id}
                  title={`Point ${point.pointNumber}: ${voidScored ? "Void scored" : `${game.opponent} scored`} (${point.lineType}-line)`}
                  className={`text-xs px-2 py-0.5 rounded-md font-mono border ${
                    voidScored
                      ? "bg-success/15 border-success/30 text-success"
                      : "border-destructive/30 text-destructive"
                  }`}
                >
                  {voidScored ? "✓ " : ""}P{point.pointNumber}
                </span>
              )
            })}
          </div>
        </section>
      )}

    </div>
  )
}

function WatchSkeleton() {
  return (
    <div className="flex flex-col max-w-3xl mx-auto px-4 sm:px-6 py-6 w-full" aria-busy aria-label="Loading game">
      <Skeleton className="h-5 w-48 mb-4" />
      <div className="flex items-center justify-center gap-8 pt-4 pb-2">
        <Skeleton className="h-24 w-20" />
        <Skeleton className="h-24 w-20" />
      </div>
      <div className="min-h-5 mb-4" />
      <Skeleton className="w-full rounded-xl" style={{ aspectRatio: "2.5 / 1" }} />
    </div>
  )
}

// --- Field visualization ---

function FieldView({
  opponent,
  possession,
  voidAttacksRight,
  flashEZ,
  linePlayers,
  isActive,
}: {
  opponent: string
  possession: Possession
  voidAttacksRight: boolean
  flashEZ: "LEFT" | "RIGHT" | null
  linePlayers: PlayerItem[]
  isActive: boolean
}) {
  const voidOnOffense = possession === "VOID"
  // Arrows follow the disc: toward VOID's attack EZ when on O, toward opponent's attack EZ when on D
  const arrowsGoRight = (voidOnOffense && voidAttacksRight) || (!voidOnOffense && !voidAttacksRight)

  // Left EZ is VOID's attack target when !voidAttacksRight, defend target when voidAttacksRight
  const leftIsAttack = !voidAttacksRight
  const rightIsAttack = voidAttacksRight

  return (
    <>
      <style>{`
        @keyframes arrowFlowRight {
          0%   { opacity: 0; transform: translateX(-8px); }
          35%  { opacity: 0.5; }
          65%  { opacity: 0.5; }
          100% { opacity: 0; transform: translateX(8px); }
        }
        @keyframes arrowFlowLeft {
          0%   { opacity: 0; transform: translateX(8px); }
          35%  { opacity: 0.5; }
          65%  { opacity: 0.5; }
          100% { opacity: 0; transform: translateX(-8px); }
        }
      `}</style>

      <div className="relative w-full rounded-xl overflow-hidden border border-border" style={{ aspectRatio: "2.5 / 1" }}>
        {/* Field base */}
        <div className="absolute inset-0 bg-[#1a2e1a]" />

        <div className="absolute inset-0 flex">
          {/* Left end zone */}
          <div className={`relative w-[20%] border-r border-border-strong flex flex-col items-center justify-center gap-1 transition-colors duration-300 ${
            flashEZ === "LEFT" ? "bg-success/40" : leftIsAttack ? "bg-success/5" : "bg-surface"
          }`}>
            <span className="text-fg-muted text-[11px] font-bold tracking-wider rotate-[-90deg] select-none whitespace-nowrap">VOID</span>
            {isActive && (
              <span className={`absolute bottom-2 text-[11px] font-bold tracking-widest whitespace-nowrap ${
                leftIsAttack ? "text-success/60" : "text-fg-faint"
              }`}>
                {leftIsAttack ? "ATTACK" : "DEFEND"}
              </span>
            )}
            {flashEZ === "LEFT" && <div className="absolute inset-0 bg-success/20 motion-safe:animate-ping" />}
          </div>

          {/* Main field */}
          <div className="relative flex-1">
            {/* Center line */}
            <div className="absolute inset-y-0 left-1/2 w-px bg-surface-2" />

            {/* Flowing direction arrows */}
            {isActive && (
              <div className="absolute inset-0 flex items-center overflow-hidden pointer-events-none">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                  <span
                    key={i}
                    className="absolute select-none text-fg-faint font-light motion-reduce:[animation:none!important] motion-reduce:opacity-50"
                    style={{
                      fontSize: "18px",
                      left: `${3 + i * 13}%`,
                      animation: `${arrowsGoRight ? "arrowFlowRight" : "arrowFlowLeft"} 2.4s ease-in-out ${i * 0.18}s infinite`,
                    }}
                  >
                    {arrowsGoRight ? "›" : "‹"}
                  </span>
                ))}
              </div>
            )}

            {/* Offense/Defense badge + player dots — same vertical axis */}
            {isActive && (
              <>
                {/* Row: players set the height, badge centers within it */}
                <div className="absolute left-0 right-0 top-2 flex justify-center gap-1 z-10">
                  {/* Badge: vertically centered within the player row */}
                  <div className={`absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-md ${
                    voidOnOffense
                      ? "text-success bg-success/15 border border-success/25"
                      : "text-fg-muted bg-surface border border-border"
                  }`}>
                    <span className="whitespace-nowrap">{voidOnOffense ? "O-line" : "D-line"}</span>
                  </div>
                  {linePlayers.slice(0, 7).map(p => (
                    <div
                      key={p.id}
                      title={`${p.first_name} ${p.last_name}`}
                      className="w-8 h-8 rounded-full flex items-center justify-center border text-[11px] font-bold transition-all duration-500 border-transparent text-foreground"
                      style={{ backgroundColor: "rgb(60, 21, 97)", boxShadow: "0 2px 8px rgba(0,0,0,0.6)" }}
                    >
                      {p.number}
                    </div>
                  ))}
                </div>
              </>
            )}

          </div>

          {/* Right end zone */}
          <div className={`relative w-[20%] border-l border-border-strong flex flex-col items-center justify-center transition-colors duration-300 ${
            flashEZ === "RIGHT" ? "bg-success/40" : rightIsAttack ? "bg-success/5" : "bg-surface"
          }`}>
            <span className="text-fg-muted text-[11px] font-bold tracking-wider rotate-[90deg] select-none truncate max-w-[60px]">
              {opponent.toUpperCase()}
            </span>
            {isActive && (
              <span className={`absolute bottom-2 text-[11px] font-bold tracking-widest whitespace-nowrap ${
                rightIsAttack ? "text-success/60" : "text-fg-faint"
              }`}>
                {rightIsAttack ? "ATTACK" : "DEFEND"}
              </span>
            )}
            {flashEZ === "RIGHT" && <div className="absolute inset-0 bg-success/20 motion-safe:animate-ping" />}
          </div>
        </div>
      </div>
    </>
  )
}
