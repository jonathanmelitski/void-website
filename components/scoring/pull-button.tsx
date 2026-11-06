"use client"

import { useEffect, useRef, useState } from "react"
import { useHaptics } from "react-haptics"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { PlayerItem } from "@/lib/aws/players"
import type { PullResult } from "@/lib/point-event-meta"
import { byDisplayName } from "./shared"

/** Holds shorter than this are taps, not pulls (a real pull hangs for seconds). */
const MIN_HOLD_MS = 400
/** The fill bar reaches the end here; most pulls land well before. */
const BAR_FULL_MS = 7000
/** A touch that stays put this long is a hold; one that moves first is a scroll. */
const CONFIRM_MS = 150
const MOVE_SLOP_PX = 10

export type PullLog = {
  team: "VOID" | "OPP"
  playerId?: string
  result: PullResult
  pulledAt: Date
  landedAt: Date
}

type State =
  | { phase: "idle"; hint?: string }
  /** Finger down, not yet known to be a hold (it may turn into a scroll). */
  | { phase: "pending"; startedAt: number; x: number; y: number }
  | { phase: "holding"; startedAt: number }
  | { phase: "result"; pulledAt: Date; landedAt: Date }

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * Hold while the pull is in the air: press on the release, let go when it lands or is caught. Then
 * In / Out (and, on our pulls, who threw it). Android pulses while held; iOS can't vibrate on a
 * hold, so it ticks on the In/Out tap, and every device shows the live hang-time counter.
 * Keyboard: hold Space or Enter.
 */
export function PullButton({
  lineType,
  opponent,
  linePlayers,
  defaultPullerId,
  busy,
  onLog,
}: {
  /** D-line: VOID pulls. O-line: the opponent pulls. */
  lineType: "O" | "D"
  opponent: string
  linePlayers: PlayerItem[]
  defaultPullerId?: string
  busy: boolean
  onLog: (pull: PullLog) => Promise<boolean>
}) {
  const { trigger, cancel } = useHaptics()
  const [state, setState] = useState<State>({ phase: "idle" })
  const [elapsed, setElapsed] = useState(0)
  const [pickedPullerId, setPullerId] = useState<string | undefined>()
  const pullerId = pickedPullerId ?? defaultPullerId
  const raf = useRef<number | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const holdingRef = useRef(false)
  const ourPull = lineType === "D"

  // Swipes that start on the button scroll the page (touch-action: pan-y). Once a hold is confirmed,
  // block scrolling so a drifting finger during a long hang doesn't cancel the pull. Needs a
  // non-passive native listener; React's touch handlers are passive.
  useEffect(() => {
    const el = buttonRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => { if (holdingRef.current && e.cancelable) e.preventDefault() }
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    return () => el.removeEventListener("touchmove", onTouchMove)
  }, [state.phase])

  // Live counter while held (about 10 updates a second is plenty)
  useEffect(() => {
    if (state.phase !== "holding") return
    let last = 0
    const tick = (now: number) => {
      if (now - last > 90) { setElapsed(Date.now() - state.startedAt); last = now }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [state])

  useEffect(() => () => {
    cancel()
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [cancel])

  function confirm(startedAt: number) {
    holdingRef.current = true
    setElapsed(Date.now() - startedAt)
    setState({ phase: "holding", startedAt })
    trigger("pull-hold", { repeat: true })
  }

  /** The release time is the moment the finger lands, even though the hold is confirmed later. */
  function start(x: number, y: number, immediate = false) {
    if (busy || state.phase === "holding" || state.phase === "pending") return
    const startedAt = Date.now()
    setElapsed(0)
    if (immediate) { confirm(startedAt); return }
    setState({ phase: "pending", startedAt, x, y })
    confirmTimer.current = setTimeout(() => confirm(startedAt), CONFIRM_MS)
  }

  function move(x: number, y: number) {
    if (state.phase === "pending" && Math.hypot(x - state.x, y - state.y) > MOVE_SLOP_PX) reset() // a swipe
  }

  function reset() {
    if (confirmTimer.current) { clearTimeout(confirmTimer.current); confirmTimer.current = null }
    holdingRef.current = false
    cancel()
    setState({ phase: "idle" })
  }

  function end() {
    if (confirmTimer.current) { clearTimeout(confirmTimer.current); confirmTimer.current = null }
    holdingRef.current = false
    if (state.phase === "pending") {
      setState({ phase: "idle", hint: "Hold from the throw until it lands or is caught." })
      return
    }
    if (state.phase !== "holding") return
    cancel()
    const landed = Date.now()
    if (landed - state.startedAt < MIN_HOLD_MS) {
      setState({ phase: "idle", hint: "Hold from the throw until it lands or is caught." })
      return
    }
    setState({ phase: "result", pulledAt: new Date(state.startedAt), landedAt: new Date(landed) })
  }

  /** The browser took the touch (scroll) or the pointer went away: no pull. */
  function abort() {
    if (state.phase === "pending" || state.phase === "holding") reset()
  }

  async function choose(result: PullResult) {
    if (state.phase !== "result") return
    const ok = await onLog({
      team: ourPull ? "VOID" : "OPP",
      playerId: ourPull ? pullerId : undefined,
      result,
      pulledAt: state.pulledAt,
      landedAt: state.landedAt,
    })
    if (ok) setState({ phase: "idle" })
  }

  if (state.phase === "result") {
    const hang = state.landedAt.getTime() - state.pulledAt.getTime()
    const roster = [...linePlayers].sort(byDisplayName)
    const needsPuller = ourPull && roster.length > 0 && !pullerId
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">
            {ourPull ? "Our pull" : `${opponent} pull`} · <span className="font-mono tabular-nums">{seconds(hang)}</span>
          </p>
          <Button variant="quiet" size="sm" className="h-10" onClick={() => setState({ phase: "idle" })} disabled={busy}>
            Redo
          </Button>
        </div>

        {ourPull && roster.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-xs text-fg-muted">Pulled by</legend>
            <div className="flex flex-wrap gap-1.5">
              {roster.map(p => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={pullerId === p.id}
                  onClick={() => setPullerId(p.id)}
                  disabled={busy}
                  className={cn(
                    "h-10 rounded-full border px-3 text-sm transition-colors touch-manipulation",
                    pullerId === p.id ? "border-foreground bg-foreground text-background" : "border-border text-fg-secondary hover:bg-surface-3",
                  )}
                >
                  {p.first_name}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button size="touch" data-haptic="success" onClick={() => choose("IN")} disabled={busy || needsPuller}>
            In bounds
          </Button>
          <Button size="touch" variant="outline" data-haptic="warning" onClick={() => choose("OUT")} disabled={busy || needsPuller}>
            Out of bounds
          </Button>
        </div>
        {needsPuller && <p className="text-xs text-fg-muted">Pick who pulled.</p>}
      </div>
    )
  }

  const holding = state.phase === "holding"
  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={e => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId) // release still lands here if the finger slides off
          // Mouse and pen can't scroll by dragging, so they're a hold straight away.
          start(e.clientX, e.clientY, e.pointerType !== "touch")
        }}
        onPointerMove={e => move(e.clientX, e.clientY)}
        onPointerUp={end}
        onPointerCancel={abort}
        onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(0, 0, true) } }}
        onKeyUp={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); end() } }}
        onContextMenu={e => e.preventDefault()}
        disabled={busy}
        aria-label={holding ? `Pull in the air, ${seconds(elapsed)}. Release when it lands.` : `Hold during the ${ourPull ? "" : `${opponent} `}pull`}
        className={cn(
          "relative flex h-24 w-full select-none flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl border text-sm font-medium transition-colors touch-pan-y [-webkit-touch-callout:none] disabled:opacity-50",
          holding ? "border-brand bg-surface-3" : "border-border-strong bg-surface hover:bg-surface-2",
        )}
      >
        {/* Fill bar: visual feedback while held (iOS gets no hold haptics) */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-brand/20 motion-reduce:hidden"
          style={{ width: holding ? `${Math.min(100, (elapsed / BAR_FULL_MS) * 100)}%` : 0 }}
        />
        {holding ? (
          <>
            <span className="relative font-mono text-3xl tabular-nums">{seconds(elapsed)}</span>
            <span className="relative text-xs text-fg-muted">Let go when it lands</span>
          </>
        ) : (
          <>
            <span className="relative">Hold during the pull</span>
            <span className="relative text-xs text-fg-muted">{ourPull ? "Void pulls" : `${opponent} pulls`} · press on release</span>
          </>
        )}
      </button>
      <p aria-live="polite" className="mt-1 min-h-4 text-xs text-fg-muted">
        {state.phase === "idle" ? state.hint : ""}
      </p>
    </div>
  )
}
