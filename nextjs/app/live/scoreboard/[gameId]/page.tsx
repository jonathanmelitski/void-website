"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import type { GameItem } from "@/lib/aws/games"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem } from "@/lib/aws/point-events"
import type { LiveGameMessage } from "@/lib/live-types"

type ConnStatus = "connecting" | "connected" | "reconnecting" | "polling" | "final"
type Possession = "VOID" | "OPP"

// Shared layout constants — used in both the banner row and the main bar
// so columns align perfectly without measuring the DOM.
const INDICATOR_W = "clamp(36px, 3.6vw, 54px)"
const CENTER_W    = "clamp(44px, 4.6vw, 66px)"

function inferPossession(point: PointItem | null, events: PointEventItem[]): Possession {
  if (!point) return "VOID"
  const sorted = [...events].sort((a, b) => a.sortOrder - b.sortOrder)
  let voidHas = point.lineType === "O"
  for (const ev of sorted) {
    if (ev.eventType === "PULL")     voidHas = false
    if (ev.eventType === "TURNOVER") voidHas = false
    if (ev.eventType === "BLOCK")    voidHas = true
  }
  return voidHas ? "VOID" : "OPP"
}

function getBreakSide(point: PointItem): "VOID" | "OPP" {
  return point.lineType === "D" ? "VOID" : "OPP"
}

export default function ScoreboardOverlay() {
  const { gameId } = useParams<{ gameId: string }>()

  const [game, setGame]               = useState<GameItem | null>(null)
  const [points, setPoints]           = useState<PointItem[]>([])
  const [pointEvents, setPointEvents] = useState<PointEventItem[]>([])
  const [connStatus, setConnStatus]   = useState<ConnStatus>("connecting")
  const [scoreFlash, setScoreFlash]   = useState<"VOID" | "OPP" | null>(null)
  const [breakDisplay, setBreakDisplay] = useState<"VOID" | "OPP" | null>(null)
  const [breakExiting, setBreakExiting] = useState(false)

  const wsRef           = useRef<WebSocket | null>(null)
  const reconnectRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef     = useRef(0)
  const unmountedRef    = useRef(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevScoreRef    = useRef<{ void: number; opp: number } | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const breakTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shownBreaksRef  = useRef<Set<string>>(new Set())

  const applyUpdate = useCallback((data: LiveGameMessage) => {
    const prev = prevScoreRef.current
    if (prev) {
      if (data.game.scoreVoid > prev.void)         triggerScoreFlash("VOID")
      else if (data.game.scoreOpponent > prev.opp) triggerScoreFlash("OPP")
    }
    prevScoreRef.current = { void: data.game.scoreVoid, opp: data.game.scoreOpponent }

    const latestBreak = [...data.points]
      .filter(p => p.status === "COMPLETE" && p.outcome === "BREAK" && !shownBreaksRef.current.has(p.id))
      .sort((a, b) => b.pointNumber - a.pointNumber)[0]
    if (latestBreak) {
      shownBreaksRef.current.add(latestBreak.id)
      triggerBreak(getBreakSide(latestBreak))
    }

    setGame(data.game)
    setPoints(data.points)
    setPointEvents(data.pointEvents)
    if (data.game.status === "FINAL") { setConnStatus("final"); stopPolling() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function triggerScoreFlash(side: "VOID" | "OPP") {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    setScoreFlash(side)
    flashTimeoutRef.current = setTimeout(() => setScoreFlash(null), 1800)
  }

  function triggerBreak(side: "VOID" | "OPP") {
    if (breakTimeoutRef.current) clearTimeout(breakTimeoutRef.current)
    setBreakDisplay(side)
    setBreakExiting(false)
    breakTimeoutRef.current = setTimeout(() => {
      setBreakExiting(true)
      setTimeout(() => { setBreakDisplay(null); setBreakExiting(false) }, 700)
    }, 3800)
  }

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return
    setConnStatus("polling")
    async function poll() {
      try {
        const [gR, pR, eR, plR] = await Promise.all([
          fetch(`/api/games/${gameId}`),
          fetch(`/api/points?gameId=${gameId}`),
          fetch(`/api/point-events?gameId=${gameId}`),
          fetch("/api/players"),
        ])
        if (!gR.ok) return
        const [gD, pD, eD, plD] = await Promise.all([gR.json(), pR.json(), eR.json(), plR.json()])
        applyUpdate({
          game: gD,
          points: Array.isArray(pD) ? pD : [],
          pointEvents: Array.isArray(eD) ? eD : [],
          players: Array.isArray(plD) ? plD : [],
          ts: Date.now(),
        })
      } catch { /* ignore */ }
    }
    poll()
    pollIntervalRef.current = setInterval(poll, 4_000)
  }, [gameId, applyUpdate])

  function stopPolling() {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
  }

  const connect = useCallback(() => {
    if (unmountedRef.current) return
    setConnStatus(attemptsRef.current === 0 ? "connecting" : "reconnecting")
    if (attemptsRef.current >= 3) { startPolling(); return }
    try {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:"
      const wsHost = process.env.NEXT_PUBLIC_WS_HOST ?? location.host
      const ws = new WebSocket(`${protocol}//${wsHost}/ws/game/${gameId}`)
      wsRef.current = ws
      ws.onopen    = () => { attemptsRef.current = 0; setConnStatus("connected") }
      ws.onmessage = e => { try { applyUpdate(JSON.parse(e.data) as LiveGameMessage) } catch { /* ignore */ } }
      ws.onclose   = e => {
        wsRef.current = null
        if (e.code === 1000 || unmountedRef.current) return
        setConnStatus("reconnecting")
        reconnectRef.current = setTimeout(connect, Math.min(1_000 * Math.pow(2, attemptsRef.current++), 30_000))
      }
      ws.onerror = () => ws.close()
    } catch { attemptsRef.current++; startPolling() }
  }, [gameId, applyUpdate, startPolling])

  useEffect(() => {
    unmountedRef.current = false
    connect()
    return () => {
      unmountedRef.current = true
      if (reconnectRef.current)    clearTimeout(reconnectRef.current)
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
      if (breakTimeoutRef.current) clearTimeout(breakTimeoutRef.current)
      stopPolling()
      if (wsRef.current) { wsRef.current.close(1000); wsRef.current = null }
    }
  }, [connect])

  const activePoint  = points.find(p => p.status === "IN_PROGRESS") ?? null
  const activeEvents = activePoint ? pointEvents.filter(e => e.pointId === activePoint.id) : []
  const possession   = inferPossession(activePoint, activeEvents)

  const breakChance: "VOID" | "OPP" | null = (() => {
    if (!activePoint || game?.status !== "IN_PROGRESS") return null
    if (activePoint.lineType === "D" && possession === "VOID") return "VOID"
    if (activePoint.lineType === "O" && possession === "OPP")  return "OPP"
    return null
  })()

  // 2nd half starts once secondHalfStartCompletedCount is set
  const half   = game?.secondHalfStartCompletedCount != null ? "2ND" : "1ST"
  const isFinal = game?.status === "FINAL"
  const isLive  = connStatus === "connected" || connStatus === "polling"

  // Both score boxes share the same width so they're symmetric at the center seam.
  // Base it on the higher score's digit count so a 10+ score doesn't make one side wider.
  const maxScore   = Math.max(game?.scoreVoid ?? 0, game?.scoreOpponent ?? 0)
  // Padding shared between name area and score box sides so spacing is symmetric
  // scoreBoxW = digit width + 2 * PAD (visually equal distance on both sides)
  const scoreBoxW  = maxScore >= 10 ? "clamp(52px, 5.4vw, 78px)" : "clamp(40px, 4.2vw, 60px)"

  if (!game) return null

  const showBanner = !!breakChance && !breakDisplay

  return (
    <>
      <style>{`html, body { background: transparent !important; background-color: transparent !important; }`}</style>
      <style>{`
        @keyframes scoreFlash {
          0%   { transform: scale(1); }
          20%  { transform: scale(1.22); color: #4ade80; }
          100% { transform: scale(1); }
        }
        @keyframes breakIn {
          0%   { clip-path: inset(0 50% 0 50%); }
          100% { clip-path: inset(0 0% 0 0%); }
        }
        @keyframes breakOut {
          0%   { clip-path: inset(0 0% 0 0%); }
          100% { clip-path: inset(0 50% 0 50%); }
        }
        @keyframes bannerDrop {
          0%   { opacity: 0; transform: translateY(-4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes livePing {
          0%   { transform: scale(1);   opacity: 0.75; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        .score-flash { animation: scoreFlash 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) forwards; }
        .break-in    { animation: breakIn  0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .break-out   { animation: breakOut 0.7s  cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .banner-drop { animation: bannerDrop 0.2s ease-out forwards; }
      `}</style>

      <div
        className="fixed inset-x-0 flex flex-col items-center pointer-events-none"
        style={{ bottom: "2vh", fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }}
      >
        {/* ── SCALED CONTAINER — middle 3/5 ── */}
        <div
          style={{
            width: "60vw", minWidth: 420, maxWidth: 960,
            borderRadius: 10,
            overflow: "hidden",
          }}
        >

          {/* ── BREAK CHANCE BANNER ROW ── */}
          {/* Always in the DOM — height animates so it slides up/down from the bar edge */}
          <div
            style={{
              height: showBanner ? "clamp(14px, 1.4vw, 20px)" : 0,
              overflow: "hidden",
              transition: "height 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
              display: "flex",
              width: "100%",
              // Round the top corners here so the wrapper's own clip applies them
              borderRadius: "10px 10px 0 0",
            }}
          >
            {/* Inner row slides up from below as height opens */}
            <div
              className="flex w-full"
              style={{
                height: "clamp(14px, 1.4vw, 20px)",
                transform: showBanner ? "translateY(0)" : "translateY(100%)",
                transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <div style={{ width: INDICATOR_W, flexShrink: 0 }} />
              <div className="flex items-center justify-center"
                   style={{ flex: "1 1 0", background: breakChance === "VOID" ? "#991b1b" : "transparent" }}>
                {breakChance === "VOID" && (
                  <span className="font-black tracking-[0.2em] uppercase text-white"
                        style={{ fontSize: "clamp(7px, 0.8vw, 10px)" }}>
                    Break Chance
                  </span>
                )}
              </div>
              <div style={{ width: CENTER_W, flexShrink: 0 }} />
              <div className="flex items-center justify-center"
                   style={{ flex: "1 1 0", background: breakChance === "OPP" ? "#991b1b" : "transparent" }}>
                {breakChance === "OPP" && (
                  <span className="font-black tracking-[0.2em] uppercase text-white"
                        style={{ fontSize: "clamp(7px, 0.8vw, 10px)" }}>
                    Break Chance
                  </span>
                )}
              </div>
              <div style={{ width: INDICATOR_W, flexShrink: 0 }} />
            </div>
          </div>

          {/* ── MAIN BAR ── */}
          <div className="flex items-stretch w-full"
               style={{ height: "3.2vw", minHeight: 36, maxHeight: 48, boxShadow: "0 6px 32px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.4)" }}>

            {/* Left — logo box */}
            <div
              className="flex items-center justify-center shrink-0"
              style={{
                width: INDICATOR_W,
                background: "white",
                borderRight: "1px solid rgba(0,0,0,0.1)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/favicon.ico"
                alt="VOID"
                style={{
                  width: "clamp(16px, 1.8vw, 26px)",
                  height: "clamp(16px, 1.8vw, 26px)",
                  borderRadius: "clamp(3px, 0.35vw, 5px)",
                  objectFit: "contain",
                  imageRendering: "auto",
                }}
              />
            </div>

            {/* VOID block — always in the flex tree; BREAK overlays absolutely */}
            <VoidBlock
              score={game.scoreVoid}
              possession={possession}
              voidOnOLine={activePoint?.lineType === "O"}
              flash={scoreFlash === "VOID"}
              isFinal={isFinal}
              scoreBoxW={scoreBoxW}
              showBreak={breakDisplay === "VOID"}
              breakExiting={breakExiting}
            />

            {/* Center panel */}
            <div
              className="flex flex-col items-center justify-center shrink-0"
              style={{
                width: CENTER_W,
                background: "rgba(6,6,10,0.95)",
                borderLeft:  "1px solid rgba(255,255,255,0.06)",
                borderRight: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {isFinal ? (
                <span style={{ fontSize: "clamp(5px, 0.55vw, 8px)", color: "rgba(255,255,255,0.4)", fontWeight: 700, letterSpacing: "0.18em" }}>
                  FINAL
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <span className="relative flex" style={{ width: 6, height: 6 }}>
                    <span className="absolute inline-flex h-full w-full rounded-full"
                          style={{ background: "#f87171", animation: "livePing 1.1s ease-out infinite" }} />
                    <span className="relative inline-flex rounded-full" style={{ width: 6, height: 6, background: "#f87171" }} />
                  </span>
                  <span style={{ fontSize: "clamp(5px, 0.55vw, 8px)", color: "#f87171", fontWeight: 700, letterSpacing: "0.16em" }}>LIVE</span>
                </span>
              )}
            </div>

            {/* OPP block — always in the flex tree; BREAK overlays absolutely */}
            <OppBlock
              name={game.opponent}
              score={game.scoreOpponent}
              possession={possession}
              oppOnOLine={activePoint?.lineType === "D"}
              flash={scoreFlash === "OPP"}
              isFinal={isFinal}
              scoreBoxW={scoreBoxW}
              showBreak={breakDisplay === "OPP"}
              breakExiting={breakExiting}
            />

            {/* Right — half indicator */}
            <div
              className="flex flex-col items-center justify-center shrink-0"
              style={{
                width: INDICATOR_W,
                background: "white",
                borderLeft: "1px solid rgba(0,0,0,0.1)",
              }}
            >
              {isFinal ? (
                <span className="font-black uppercase text-black"
                      style={{ fontSize: "clamp(6px, 0.65vw, 9px)", letterSpacing: "0.04em" }}>
                  FINAL
                </span>
              ) : (
                <span className="font-black text-black tabular-nums"
                      style={{ fontSize: "clamp(9px, 0.95vw, 14px)", lineHeight: 1 }}>
                  {half}
                </span>
              )}
            </div>
          </div>

          {/* ── BOTTOM STRIP ── */}
          <div
            className="flex items-center justify-center w-full"
            style={{
              height: "clamp(10px, 0.9vw, 14px)",
              background: "rgba(220,220,228,0.9)",
              borderTop: "1px solid rgba(0,0,0,0.07)",
            }}
          >
            <span style={{ fontSize: "clamp(5px, 0.52vw, 8px)", color: "rgba(30,30,60,0.5)", fontWeight: 600, letterSpacing: "0.2em" }}
                  className="uppercase tracking-widest">
              {[game.round, `Cap ${game.cap}`, "VOID Ultimate"].filter(Boolean).join("  ·  ")}
            </span>
          </div>

        </div>{/* end scaled container */}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────
// VOID team block
// ─────────────────────────────────────────────
function VoidBlock({
  score, possession, voidOnOLine, flash, isFinal, scoreBoxW, showBreak, breakExiting,
}: {
  score: number; possession: Possession; voidOnOLine: boolean | undefined
  flash: boolean; isFinal: boolean; scoreBoxW: string
  showBreak: boolean; breakExiting: boolean
}) {
  return (
    <div
      className="relative"
      style={{
        flex: "1 1 0",
        display: "flex",
        alignItems: "stretch",
        background: isFinal
          ? "linear-gradient(90deg, #f8f7ff 0%, #ede9fe 100%)"
          : "linear-gradient(90deg, rgb(55,18,95) 0%, rgb(72,26,117) 100%)",
        transition: "background 0.4s ease",
        overflow: "hidden",
      }}
    >
      {/* Permanent left-edge color bar */}
      {!isFinal && (
        <div className="absolute left-0 inset-y-0 w-[4px]"
             style={{ background: "linear-gradient(180deg, #c4b5fd, #7c3aed)" }} />
      )}

      {/* Team name — left area */}
      <div className="flex items-center flex-1" style={{ padding: "0 clamp(14px, 1.6vw, 24px)" }}>
        <span className="font-black uppercase leading-none"
              style={{ fontSize: "clamp(8px, 1.2vw, 17px)", letterSpacing: "0.04em", color: isFinal ? "rgb(55,18,95)" : "#ddd6fe" }}>
          VOID
        </span>
      </div>

      {/* O-line triangle — full height, points left (away from score box) */}
      {voidOnOLine && !isFinal && (
        <div
          className="flex-shrink-0 self-stretch"
          style={{
            width: "clamp(6px, 0.7vw, 10px)",
            background: "white",
            clipPath: "polygon(100% 0, 100% 100%, 0 50%)",
            filter: "drop-shadow(-2px 0 3px rgba(0,0,0,0.35))",
          }}
        />
      )}

      {/* Score box — full height, flush at right (center) edge, no border-radius */}
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: scoreBoxW,
          background: isFinal ? "rgba(109,40,217,0.12)" : "rgba(139,92,246,0.3)",
        }}
      >
        <span
          key={flash ? `f${score}` : `s${score}`}
          className={`font-black tabular-nums leading-none ${flash ? "score-flash" : ""}`}
          style={{ fontSize: "clamp(14px, 2.1vw, 30px)", color: isFinal ? "rgb(55,18,95)" : "white" }}
        >
          {score}
        </span>
      </div>

      {/* BREAK overlay — absolute so it never shifts the flex layout */}
      {showBreak && (
        <div
          className={`absolute inset-0 flex items-center justify-center ${breakExiting ? "break-out" : "break-in"}`}
          style={{ background: "#b91c1c" }}
        >
          <span className="font-black uppercase text-white"
                style={{ fontSize: "clamp(12px, 1.7vw, 24px)", letterSpacing: "0.12em" }}>
            BREAK
          </span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Opponent block
// ─────────────────────────────────────────────
function OppBlock({
  name, score, possession, oppOnOLine, flash, isFinal, scoreBoxW, showBreak, breakExiting,
}: {
  name: string; score: number; possession: Possession; oppOnOLine: boolean | undefined
  flash: boolean; isFinal: boolean; scoreBoxW: string
  showBreak: boolean; breakExiting: boolean
}) {
  return (
    <div
      className="relative"
      style={{
        flex: "1 1 0",
        display: "flex",
        alignItems: "stretch",
        background: isFinal
          ? "linear-gradient(90deg, #e8e8ee 0%, #d8d8e4 100%)"
          : "linear-gradient(90deg, #1e2433 0%, #252d3d 100%)",
        transition: "background 0.4s ease",
        overflow: "hidden",
      }}
    >
      {/* Permanent right-edge color bar */}
      {!isFinal && (
        <div className="absolute right-0 inset-y-0 w-[4px]"
             style={{ background: "linear-gradient(180deg, #94a3b8, #475569)" }} />
      )}

      {/* Score box — full height, flush at left (center) edge, no border-radius */}
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: scoreBoxW,
          background: isFinal ? "rgba(30,36,51,0.1)" : "rgba(100,116,139,0.3)",
        }}
      >
        <span
          key={flash ? `f${score}` : `s${score}`}
          className={`font-black tabular-nums leading-none ${flash ? "score-flash" : ""}`}
          style={{ fontSize: "clamp(14px, 2.1vw, 30px)", color: isFinal ? "#1e2433" : "white" }}
        >
          {score}
        </span>
      </div>

      {/* O-line triangle — full height, points right (away from score box) */}
      {oppOnOLine && !isFinal && (
        <div
          className="flex-shrink-0 self-stretch"
          style={{
            width: "clamp(6px, 0.7vw, 10px)",
            background: "white",
            clipPath: "polygon(0 0, 100% 50%, 0 100%)",
            filter: "drop-shadow(2px 0 3px rgba(0,0,0,0.35))",
          }}
        />
      )}

      {/* Team name — right area */}
      <div className="flex items-center flex-1 justify-end" style={{ padding: "0 clamp(14px, 1.6vw, 24px)" }}>
        <span className="font-black uppercase leading-none truncate"
              style={{ fontSize: "clamp(8px, 1.2vw, 17px)", letterSpacing: "0.04em", maxWidth: "18vw", color: isFinal ? "#1e2433" : "#cbd5e1" }}>
          {name}
        </span>
      </div>

      {/* BREAK overlay — absolute so it never shifts the flex layout */}
      {showBreak && (
        <div
          className={`absolute inset-0 flex items-center justify-center ${breakExiting ? "break-out" : "break-in"}`}
          style={{ background: "#b91c1c" }}
        >
          <span className="font-black uppercase text-white"
                style={{ fontSize: "clamp(12px, 1.7vw, 24px)", letterSpacing: "0.12em" }}>
            BREAK
          </span>
        </div>
      )}
    </div>
  )
}
