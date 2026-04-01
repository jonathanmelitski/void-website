"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import type { GameItem } from "@/lib/aws/games"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem } from "@/lib/aws/point-events"
import type { LiveGameMessage } from "@/lib/live-types"

type ConnStatus = "connecting" | "connected" | "reconnecting" | "polling" | "final"
type Possession = "VOID" | "OPP"

// ── Fixed pixel dimensions — overlay always renders in a 1920×1080 context ──
const INDICATOR_W = 54   // logo box and half-indicator box
const CENTER_W    = 66   // center LIVE / FINAL panel
const BAR_H       = 48   // main score bar height
const BANNER_H    = 20   // break-chance banner strip
const LOGO_SIZE   = 26   // favicon inside logo box
const SCORE_FONT  = 30   // score digits
const NAME_FONT   = 17   // team name text
const BREAK_FONT  = 24   // BREAK overlay text
const BANNER_FONT = 10   // "Break Chance" banner text
const TRIANGLE_W  = 10   // possession triangle width
const CENTER_FONT = 8    // LIVE / FINAL label in center panel
const HALF_FONT   = 14   // half number (1ST / 2ND)
const HALF_SM     = 9    // half "FINAL" small text
const STRIP_H     = 14   // bottom info strip height
const STRIP_FONT  = 8    // bottom strip text

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

  const half    = game?.secondHalfStartCompletedCount != null ? "2ND" : "1ST"
  const isFinal = game?.status === "FINAL"
  const maxScore = Math.max(game?.scoreVoid ?? 0, game?.scoreOpponent ?? 0)
  const scoreBoxW = maxScore >= 10 ? 78 : 60

  if (!game) return null

  const showBanner = !!breakChance && !breakDisplay

  return (
    <>
      <style>{`
        html, body {
          background: transparent !important;
          background-color: transparent !important;
          margin: 0; padding: 0;
          width: 1920px; height: 1080px;
          overflow: hidden;
          font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
        }
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
        @keyframes livePing {
          0%   { transform: scale(1);   opacity: 0.75; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        .score-flash { animation: scoreFlash 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) forwards; }
        .break-in    { animation: breakIn  0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .break-out   { animation: breakOut 0.7s  cubic-bezier(0.4, 0, 0.2, 1) forwards; }
      `}</style>

      {/* Fixed 1920×1080 canvas */}
      <div style={{
        position: "fixed", top: 0, left: 0,
        width: 1920, height: 1080,
        overflow: "hidden", pointerEvents: "none",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: 22,
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}>
        {/* ── Scaled container — 1152px wide (middle 3/5 of 1920px) ── */}
        <div style={{ width: 1152, borderRadius: 10, overflow: "hidden" }}>

          {/* ── BREAK CHANCE BANNER ── */}
          <div style={{
            height: showBanner ? BANNER_H : 0,
            overflow: "hidden",
            transition: "height 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
            display: "flex", width: "100%",
            borderRadius: "10px 10px 0 0",
          }}>
            <div style={{
              display: "flex", width: "100%",
              height: BANNER_H,
              transform: showBanner ? "translateY(0)" : "translateY(100%)",
              transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
            }}>
              <div style={{ width: INDICATOR_W, flexShrink: 0 }} />
              <div style={{
                flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "center",
                background: breakChance === "VOID" ? "#991b1b" : "transparent",
              }}>
                {breakChance === "VOID" && (
                  <span style={{ fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "white", fontSize: BANNER_FONT }}>
                    Break Chance
                  </span>
                )}
              </div>
              <div style={{ width: CENTER_W, flexShrink: 0 }} />
              <div style={{
                flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "center",
                background: breakChance === "OPP" ? "#991b1b" : "transparent",
              }}>
                {breakChance === "OPP" && (
                  <span style={{ fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "white", fontSize: BANNER_FONT }}>
                    Break Chance
                  </span>
                )}
              </div>
              <div style={{ width: INDICATOR_W, flexShrink: 0 }} />
            </div>
          </div>

          {/* ── MAIN BAR ── */}
          <div style={{
            display: "flex", alignItems: "stretch", width: "100%",
            height: BAR_H,
            boxShadow: "0 6px 32px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.4)",
          }}>

            {/* Logo box */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              width: INDICATOR_W,
              background: "white",
              borderRight: "1px solid rgba(0,0,0,0.1)",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/favicon.ico"
                alt="VOID"
                style={{ width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: 5, objectFit: "contain" }}
              />
            </div>

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
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0,
              width: CENTER_W,
              background: "rgba(6,6,10,0.95)",
              borderLeft:  "1px solid rgba(255,255,255,0.06)",
              borderRight: "1px solid rgba(255,255,255,0.06)",
            }}>
              {isFinal ? (
                <span style={{ fontSize: CENTER_FONT, color: "rgba(255,255,255,0.4)", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  FINAL
                </span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ position: "relative", display: "flex", width: 6, height: 6 }}>
                    <span style={{ position: "absolute", display: "inline-flex", height: "100%", width: "100%", borderRadius: "9999px", background: "#f87171", animation: "livePing 1.1s ease-out infinite" }} />
                    <span style={{ position: "relative", display: "inline-flex", borderRadius: "9999px", width: 6, height: 6, background: "#f87171" }} />
                  </span>
                  <span style={{ fontSize: CENTER_FONT, color: "#f87171", fontWeight: 700, letterSpacing: "0.16em" }}>LIVE</span>
                </span>
              )}
            </div>

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

            {/* Half indicator */}
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0,
              width: INDICATOR_W,
              background: "white",
              borderLeft: "1px solid rgba(0,0,0,0.1)",
            }}>
              {isFinal ? (
                <span style={{ fontWeight: 900, textTransform: "uppercase", color: "black", fontSize: HALF_SM, letterSpacing: "0.04em" }}>
                  FINAL
                </span>
              ) : (
                <span style={{ fontWeight: 900, color: "black", fontSize: HALF_FONT, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {half}
                </span>
              )}
            </div>
          </div>

          {/* ── BOTTOM STRIP ── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", width: "100%",
            height: STRIP_H,
            background: "rgba(220,220,228,0.9)",
            borderTop: "1px solid rgba(0,0,0,0.07)",
          }}>
            <span style={{ fontSize: STRIP_FONT, color: "rgba(30,30,60,0.5)", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase" }}>
              {[game.round, `Cap ${game.cap}`, "VOID Ultimate"].filter(Boolean).join("  ·  ")}
            </span>
          </div>

        </div>
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
  flash: boolean; isFinal: boolean; scoreBoxW: number
  showBreak: boolean; breakExiting: boolean
}) {
  void possession
  return (
    <div style={{
      position: "relative",
      flex: "1 1 0",
      display: "flex",
      alignItems: "stretch",
      background: isFinal
        ? "linear-gradient(90deg, #f8f7ff 0%, #ede9fe 100%)"
        : "linear-gradient(90deg, rgb(55,18,95) 0%, rgb(72,26,117) 100%)",
      transition: "background 0.4s ease",
      overflow: "hidden",
    }}>
      {/* Left-edge color bar */}
      {!isFinal && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
          background: "linear-gradient(180deg, #c4b5fd, #7c3aed)",
        }} />
      )}

      {/* Team name */}
      <div style={{ display: "flex", alignItems: "center", flex: 1, padding: "0 24px" }}>
        <span style={{
          fontWeight: 900, textTransform: "uppercase", lineHeight: 1,
          fontSize: NAME_FONT, letterSpacing: "0.04em",
          color: isFinal ? "rgb(55,18,95)" : "#ddd6fe",
        }}>
          VOID
        </span>
      </div>

      {/* Possession triangle */}
      {voidOnOLine && !isFinal && (
        <div style={{
          flexShrink: 0, alignSelf: "stretch",
          width: TRIANGLE_W,
          background: "white",
          clipPath: "polygon(100% 0, 100% 100%, 0 50%)",
          filter: "drop-shadow(-2px 0 3px rgba(0,0,0,0.35))",
        }} />
      )}

      {/* Score box */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: scoreBoxW,
        background: isFinal ? "rgba(109,40,217,0.12)" : "rgba(139,92,246,0.3)",
      }}>
        <span
          key={flash ? `f${score}` : `s${score}`}
          className={flash ? "score-flash" : undefined}
          style={{
            fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1,
            fontSize: SCORE_FONT,
            color: isFinal ? "rgb(55,18,95)" : "white",
          }}
        >
          {score}
        </span>
      </div>

      {/* BREAK overlay */}
      {showBreak && (
        <div
          className={breakExiting ? "break-out" : "break-in"}
          style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#b91c1c",
          }}
        >
          <span style={{ fontWeight: 900, textTransform: "uppercase", color: "white", fontSize: BREAK_FONT, letterSpacing: "0.12em" }}>
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
  flash: boolean; isFinal: boolean; scoreBoxW: number
  showBreak: boolean; breakExiting: boolean
}) {
  void possession
  return (
    <div style={{
      position: "relative",
      flex: "1 1 0",
      display: "flex",
      alignItems: "stretch",
      background: isFinal
        ? "linear-gradient(90deg, #e8e8ee 0%, #d8d8e4 100%)"
        : "linear-gradient(90deg, #1e2433 0%, #252d3d 100%)",
      transition: "background 0.4s ease",
      overflow: "hidden",
    }}>
      {/* Right-edge color bar */}
      {!isFinal && (
        <div style={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: 4,
          background: "linear-gradient(180deg, #94a3b8, #475569)",
        }} />
      )}

      {/* Score box */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: scoreBoxW,
        background: isFinal ? "rgba(30,36,51,0.1)" : "rgba(100,116,139,0.3)",
      }}>
        <span
          key={flash ? `f${score}` : `s${score}`}
          className={flash ? "score-flash" : undefined}
          style={{
            fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1,
            fontSize: SCORE_FONT,
            color: isFinal ? "#1e2433" : "white",
          }}
        >
          {score}
        </span>
      </div>

      {/* Possession triangle */}
      {oppOnOLine && !isFinal && (
        <div style={{
          flexShrink: 0, alignSelf: "stretch",
          width: TRIANGLE_W,
          background: "white",
          clipPath: "polygon(0 0, 100% 50%, 0 100%)",
          filter: "drop-shadow(2px 0 3px rgba(0,0,0,0.35))",
        }} />
      )}

      {/* Team name */}
      <div style={{ display: "flex", alignItems: "center", flex: 1, justifyContent: "flex-end", padding: "0 24px" }}>
        <span style={{
          fontWeight: 900, textTransform: "uppercase", lineHeight: 1,
          fontSize: NAME_FONT, letterSpacing: "0.04em",
          maxWidth: 340,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: isFinal ? "#1e2433" : "#cbd5e1",
        }}>
          {name}
        </span>
      </div>

      {/* BREAK overlay */}
      {showBreak && (
        <div
          className={breakExiting ? "break-out" : "break-in"}
          style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#b91c1c",
          }}
        >
          <span style={{ fontWeight: 900, textTransform: "uppercase", color: "white", fontSize: BREAK_FONT, letterSpacing: "0.12em" }}>
            BREAK
          </span>
        </div>
      )}
    </div>
  )
}
