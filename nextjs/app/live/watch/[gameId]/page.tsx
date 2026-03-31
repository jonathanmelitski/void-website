"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import type { GameItem } from "@/lib/aws/games"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"
import type { PlayerItem } from "@/lib/aws/players"
import type { LiveGameMessage } from "@/lib/live-types"

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
}

const EVENT_COLORS: Record<PointEventType, string> = {
  GOAL: "text-green-400",
  ASSIST: "text-blue-400",
  TURNOVER: "text-red-400",
  BLOCK: "text-yellow-400",
  PULL: "text-white/40",
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
          triggerFlash(wasAttackingRight ? "RIGHT" : "LEFT")
        } else {
          // opponent attacks opposite direction
          triggerFlash(wasAttackingRight ? "LEFT" : "RIGHT")
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

  function triggerFlash(side: "LEFT" | "RIGHT") {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    setFlashEZ(side)
    setScorePulse(side)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashEZ(null)
      setScorePulse(null)
    }, 2000)
  }

  // --- HTTP polling fallback ---
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return
    setConnStatus("polling")

    async function poll() {
      try {
        const [gameRes, pointsRes, eventsRes, playersRes] = await Promise.all([
          fetch(`/api/games/${gameId}`),
          fetch(`/api/points?gameId=${gameId}`),
          fetch(`/api/point-events?gameId=${gameId}`),
          fetch("/api/players"),
        ])
        if (!gameRes.ok) return
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

    // Switch to polling after 3 consecutive WS failures
    if (attemptsRef.current >= 3) {
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
  }, [connect])

  // --- Derived state ---

  const activePoint = points.find(p => p.status === "IN_PROGRESS") ?? null
  const completedPoints = points
    .filter(p => p.status === "COMPLETE")
    .sort((a, b) => a.pointNumber - b.pointNumber)
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
  const recentEvents = [...pointEvents]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20)
  const possession = inferPossession(activePoint)
  const activeLinePlayers = activePoint
    ? activePoint.playerIds
        .map(id => players.find(p => p.id === id))
        .filter(Boolean) as PlayerItem[]
    : []

  const STATUS_INDICATOR: Record<ConnStatus, { label: string; color: string; pulse: boolean }> = {
    connecting:   { label: "Connecting…",   color: "text-white/30", pulse: false },
    connected:    { label: "Live",           color: "text-green-400", pulse: true },
    reconnecting: { label: "Reconnecting…", color: "text-white/40", pulse: false },
    polling:      { label: "Live",           color: "text-yellow-400", pulse: true },
    final:        { label: "Final",          color: "text-white/50", pulse: false },
  }
  const si = STATUS_INDICATOR[connStatus]

  if (!game && (connStatus === "connecting" || connStatus === "reconnecting")) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  if (!game) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-white/40 text-sm">Game not found or not yet started.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0 text-left max-w-3xl mx-auto px-4 py-6 w-full">

      {/* Header bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-medium ${si.color}`}>
            {si.pulse && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
              </span>
            )}
            {si.label}
          </span>
          <span className="text-white/20 text-xs">·</span>
          <span className="text-white/60 text-sm font-medium">VOID vs. {game.opponent}</span>
          {game.round && <span className="text-white/30 text-xs">{game.round}</span>}
        </div>
        <span className="text-white/25 text-xs">Cap {game.cap}</span>
      </div>

      {/* Score */}
      <div className="flex items-center justify-center gap-8 py-4 mb-4">
        <div className="flex flex-col items-center gap-1">
          <span className="text-white/40 text-xs font-medium tracking-widest uppercase">VOID</span>
          <span className={`text-7xl font-black font-mono transition-transform duration-300 ${scorePulse === "VOID" ? "scale-125 text-green-400" : "text-white"}`}>
            {game.scoreVoid}
          </span>
        </div>
        <span className="text-white/20 text-3xl font-thin">–</span>
        <div className="flex flex-col items-center gap-1">
          <span className="text-white/40 text-xs font-medium tracking-widest uppercase">{game.opponent}</span>
          <span className={`text-7xl font-black font-mono transition-transform duration-300 ${scorePulse === "OPP" ? "scale-125 text-green-400" : "text-white"}`}>
            {game.scoreOpponent}
          </span>
        </div>
      </div>

      {/* Field */}
      <FieldView
        opponent={game.opponent}
        possession={possession}
        voidAttacksRight={voidAttacksRight}
        flashEZ={game.status !== "FINAL" ? flashEZ : null}
        linePlayers={activeLinePlayers}
        isActive={game.status === "IN_PROGRESS" && !!activePoint}
      />

      {/* Active point info */}
      {activePoint && (
        <div className="flex items-center gap-2 mt-3 px-1 text-xs text-white/40">
          <span>P{activePoint.pointNumber}</span>
          <span>·</span>
          <span className={activePoint.lineType === "O" ? "text-blue-400/70" : "text-orange-400/70"}>
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

      {/* Event log */}
      {recentEvents.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-medium text-white/30 uppercase tracking-widest mb-3">Play by Play</h2>
          <div className="flex flex-col gap-1.5">
            {recentEvents.map((ev, i) => {
              const point = points.find(p => p.id === ev.pointId)
              return (
                <div
                  key={ev.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    i === 0 ? "bg-white/5 border border-white/10" : ""
                  }`}
                >
                  {point && (
                    <span className="text-white/20 font-mono text-xs w-5 shrink-0">P{point.pointNumber}</span>
                  )}
                  <span className={`font-medium shrink-0 ${EVENT_COLORS[ev.eventType]}`}>
                    {EVENT_LABELS[ev.eventType]}
                  </span>
                  <span className="text-white/60 truncate">{getPlayerName(ev.playerId)}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Completed points summary */}
      {completedPoints.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-medium text-white/30 uppercase tracking-widest mb-3">Points</h2>
          <div className="flex flex-wrap gap-1.5">
            {completedPoints.map(point => {
              const voidScored =
                (point.outcome === "HOLD" && point.lineType === "O") ||
                (point.outcome === "BREAK" && point.lineType === "D")
              return (
                <span
                  key={point.id}
                  title={`P${point.pointNumber}: ${point.outcome} (${point.lineType}-line)`}
                  className={`text-xs px-2 py-0.5 rounded font-mono ${
                    voidScored
                      ? "bg-green-400/15 text-green-400"
                      : "bg-red-400/15 text-red-400"
                  }`}
                >
                  P{point.pointNumber}
                </span>
              )
            })}
          </div>
        </section>
      )}

      {/* Final banner */}
      {game.status === "FINAL" && (
        <div className="mt-8 border border-white/10 rounded-xl px-6 py-5 text-center">
          <p className={`text-2xl font-black ${
            game.result === "WIN" ? "text-green-400" :
            game.result === "LOSS" ? "text-red-400" :
            "text-yellow-400"
          }`}>
            {game.result === "WIN" ? "VOID Wins" : game.result === "LOSS" ? `${game.opponent} Wins` : "Tie"}
          </p>
          <p className="text-white/40 text-sm mt-1">Final · {game.scoreVoid} – {game.scoreOpponent}</p>
        </div>
      )}
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

      <div className="relative w-full rounded-xl overflow-hidden border border-white/10" style={{ aspectRatio: "2.5 / 1" }}>
        {/* Field base */}
        <div className="absolute inset-0 bg-[#1a2e1a]" />

        <div className="absolute inset-0 flex">
          {/* Left end zone */}
          <div className={`relative w-[20%] border-r border-white/20 flex flex-col items-center justify-center gap-1 transition-colors duration-300 ${
            flashEZ === "LEFT" ? "bg-green-400/40" : leftIsAttack ? "bg-green-400/5" : "bg-white/3"
          }`}>
            <span className="text-white/50 text-[10px] font-bold tracking-wider rotate-[-90deg] select-none whitespace-nowrap">VOID</span>
            {isActive && (
              <span className={`absolute bottom-2 text-[8px] font-bold tracking-widest rotate-[-90deg] whitespace-nowrap ${
                leftIsAttack ? "text-green-400/60" : "text-white/25"
              }`}>
                {leftIsAttack ? "ATTACK" : "DEFEND"}
              </span>
            )}
            {flashEZ === "LEFT" && <div className="absolute inset-0 bg-green-400/20 animate-ping" />}
          </div>

          {/* Main field */}
          <div className="relative flex-1">
            {/* Center line */}
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />

            {/* Flowing direction arrows */}
            {isActive && (
              <div className="absolute inset-0 flex items-center overflow-hidden pointer-events-none">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                  <span
                    key={i}
                    className="absolute select-none text-white/25 font-light"
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
                  <div className={`absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded ${
                    voidOnOffense
                      ? "text-green-400 bg-green-400/15 border border-green-400/25"
                      : "text-white/35 bg-white/5 border border-white/10"
                  }`}>
                    {voidOnOffense ? "OFFENSE" : "DEFENSE"}
                  </div>
                  {linePlayers.slice(0, 7).map(p => (
                    <div
                      key={p.id}
                      title={`${p.first_name} ${p.last_name}`}
                      className="w-8 h-8 rounded-full flex items-center justify-center border text-[11px] font-bold transition-all duration-500 border-transparent text-white"
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
          <div className={`relative w-[20%] border-l border-white/20 flex flex-col items-center justify-center transition-colors duration-300 ${
            flashEZ === "RIGHT" ? "bg-green-400/40" : rightIsAttack ? "bg-green-400/5" : "bg-white/3"
          }`}>
            <span className="text-white/50 text-[10px] font-bold tracking-wider rotate-[90deg] select-none truncate max-w-[60px]">
              {opponent.toUpperCase()}
            </span>
            {isActive && (
              <span className={`absolute bottom-2 text-[8px] font-bold tracking-widest rotate-[90deg] whitespace-nowrap ${
                rightIsAttack ? "text-green-400/60" : "text-white/25"
              }`}>
                {rightIsAttack ? "ATTACK" : "DEFEND"}
              </span>
            )}
            {flashEZ === "RIGHT" && <div className="absolute inset-0 bg-green-400/20 animate-ping" />}
          </div>
        </div>
      </div>
    </>
  )
}
