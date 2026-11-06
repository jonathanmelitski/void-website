"use client"

import { useState } from "react"
import { ChevronLeft, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { PlayerItem } from "@/lib/aws/players"
import type { PointEventType } from "@/lib/aws/point-events"
import {
  FIELD_ZONES, FIELD_ZONE_LABELS, HUCKABLE_TYPES, OPP_TURNOVER_TYPES, TURNOVER_TYPES, TURNOVER_TYPE_LABELS, TURNOVER_WHO,
  ZONABLE_TYPES, type FieldZone,
} from "@/lib/point-event-meta"
import { PlayerTile } from "./player-tile"
import { EVENT_BUTTON, FALLBACK_BUTTON } from "./event-style"
import type { DiscTeam } from "@/lib/stats/possession"
import {
  EVENT_TYPE_COLORS, EVENT_TYPE_LABELS, LOGGABLE_EVENT_TYPES, byDisplayName, fullName,
  type LogEventOpts, type LogStep,
} from "./shared"

/** Wall-clock now (only ever called from event handlers). */
const nowMs = () => Date.now()

/**
 * Two-tap event logging: event type, then the player (or team for a timeout). With `onGoal`, Goal
 * becomes one sequence: scorer, then assister (or none), and the parent finishes the point.
 * `step`/`onStepChange` let the parent open a step (the action bar's "VOID scored" opens the goal flow).
 */
export function EventLogger({
  linePool,
  benchPool,
  opponent,
  busy,
  onLog,
  onGoal,
  onEditLine,
  types = LOGGABLE_EVENT_TYPES,
  step: controlledStep,
  onStepChange,
  possession,
  trackZones = false,
  title = "Log event",
}: {
  /** Players on the line: who can score, turn it over, go out on a sub. */
  linePool: PlayerItem[]
  /** Players who can come in on a sub. */
  benchPool: PlayerItem[]
  opponent: string
  busy: boolean
  /** Resolves true when the event was saved (the logger then returns to the type grid). */
  onLog: (type: PointEventType, opts: LogEventOpts) => Promise<boolean>
  /** Goal + assist + finish the point in one go. Resolves true when saved. */
  onGoal?: (scorerId: string, assisterId: string | null, hockeyAssisterId: string | null, at: Date, tags: { huck?: boolean; zone?: FieldZone }) => Promise<boolean>
  onEditLine?: () => void
  /** Buttons in the type grid. */
  types?: readonly PointEventType[]
  step?: LogStep
  onStepChange?: (step: LogStep) => void
  /** Who has the disc: their two likely moves become the big buttons, the rest go below. */
  possession?: DiscTeam
  /** Offer the optional field-zone chips (a per-device setting; off = no zone UI at all). */
  trackZones?: boolean
  title?: string
}) {
  const [ownStep, setOwnStep] = useState<LogStep>(null)
  const step = controlledStep !== undefined ? controlledStep : ownStep
  // The first tap of a sequence stamps the time; later steps keep it.
  // Optional tags for the event being logged; cleared when a sequence ends
  const [huck, setHuck] = useState(false)
  const [zone, setZone] = useState<FieldZone | undefined>()
  const setStep = (next: LogStep) => {
    if (!next) { setHuck(false); setZone(undefined) }
    const stamped = next && next.at === undefined ? { ...next, at: step?.at ?? nowMs() } : next
    setOwnStep(stamped)
    onStepChange?.(stamped)
  }
  const stepAt = () => new Date(step?.at ?? nowMs())
  // Per-device preference: also ask for the hockey assist (the throw before the assist)
  // Only read on the client: the assist step never renders on the server.
  const [askHockey, setAskHockey] = useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem("scoring.hockeyAssists") === "1" } catch { return false }
  })
  const toggleHockey = () => setAskHockey(v => {
    try { localStorage.setItem("scoring.hockeyAssists", v ? "0" : "1") } catch {}
    return !v
  })

  const tagsFor = (type: PointEventType) => ({
    ...(huck && HUCKABLE_TYPES.includes(type) ? { huck: true } : {}),
    ...(zone && ZONABLE_TYPES.includes(type) ? { zone } : {}),
  })

  async function log(type: PointEventType, opts: LogEventOpts) {
    if (await onLog(type, { ...opts, ...tagsFor(type), occurredAt: stepAt().toISOString() })) setStep(null)
  }

  /** Optional chips: Huck, and (when field zones are on) where. Skipping them is always fine. */
  const tagRow = (opts: { huck?: boolean; zone?: boolean }) => {
    const showZone = opts.zone && trackZones
    if (!opts.huck && !showZone) return null
    const chip = (on: boolean) => cn(
      "h-9 rounded-full border px-3 text-sm transition-colors touch-manipulation",
      on ? "border-foreground bg-foreground text-background" : "border-border text-fg-secondary hover:bg-surface-2",
    )
    return (
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {opts.huck && (
          <button type="button" aria-pressed={huck} onClick={() => setHuck(h => !h)} className={chip(huck)}>Huck</button>
        )}
        {opts.huck && showZone && <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />}
        {showZone && FIELD_ZONES.map(z => (
          <button key={z} type="button" aria-pressed={zone === z} onClick={() => setZone(cur => (cur === z ? undefined : z))} className={chip(zone === z)}>
            {FIELD_ZONE_LABELS[z]}
          </button>
        ))}
      </div>
    )
  }

  if (step === null) {
    const open = (type: PointEventType) => setStep(
      type === "SUBSTITUTION" ? { type, phase: "out" }
      : type === "GOAL" && onGoal ? { type: "GOAL_FLOW", phase: "scorer" }
      : { type } as LogStep
    )
    const primaryTypes: PointEventType[] = possession === "VOID" ? ["GOAL", "TURNOVER"] : possession === "OPP" ? ["BLOCK", "OPP_TURNOVER"] : []
    const primary = primaryTypes.filter(t => types.includes(t))
    const rest = types.filter(t => !primary.includes(t))
    const tile = (type: PointEventType, big: boolean) => {
      const { icon: Icon, tone } = EVENT_BUTTON[type] ?? FALLBACK_BUTTON
      const label = type === "OPP_TURNOVER" ? `${opponent} turned it` : EVENT_TYPE_LABELS[type]
      return (
        <button
          key={type}
          type="button"
          onClick={() => open(type)}
          disabled={busy}
          data-tap-haptic={big ? "impact-medium" : "impact-light"}
          className={cn(
            "flex min-w-0 items-center justify-center gap-2 rounded-xl border font-semibold transition-[transform,background-color] active:scale-[0.97] disabled:opacity-50 touch-manipulation motion-reduce:active:scale-100",
            big ? "h-20 flex-col text-base" : "h-12 text-sm",
            tone,
          )}
        >
          <Icon aria-hidden className={big ? "size-6" : "size-4"} />
          <span className="max-w-full truncate px-1">{label}</span>
        </button>
      )
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-fg-muted">
          {possession === "VOID" ? "VOID has the disc" : possession === "OPP" ? `${opponent} has the disc` : title}
        </p>
        {primary.length > 0 && <div className="grid grid-cols-2 gap-2">{primary.map(t => tile(t, true))}</div>}
        <div className={cn("grid gap-2", rest.length > 4 ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-4")}>
          {rest.map(t => tile(t, false))}
        </div>
      </div>
    )
  }

  const sortedLine = [...linePool].sort(byDisplayName)
  let heading: string
  let headingColor: string
  let body: React.ReactNode
  let back: () => void = () => setStep(null)

  const emptyLine = (
    <EmptyState
      icon={<Users />}
      title="No one on this line yet."
      description="Add the players on the field, then log the event."
      action={onEditLine && <Button size="sm" className="h-10" onClick={() => { setStep(null); onEditLine() }}>Edit line</Button>}
      className="rounded-xl border border-dashed border-border py-6"
    />
  )

  if (step.type === "GOAL_FLOW" && step.phase === "scorer") {
    heading = "Goal: who caught it?"
    headingColor = EVENT_TYPE_COLORS.GOAL
    body = sortedLine.length === 0 ? emptyLine : (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sortedLine.map(p => (
          <PlayerTile key={p.id} player={p} disabled={busy} onClick={() => setStep({ type: "GOAL_FLOW", phase: "assist", scorerId: p.id })} />
        ))}
      </div>
    )
  } else if (step.type === "GOAL_FLOW" && step.phase === "assist") {
    const scorerId = step.scorerId
    const scorer = linePool.find(p => p.id === scorerId)
    heading = `Goal by ${scorer ? scorer.first_name : "?"}: who threw it?`
    headingColor = EVENT_TYPE_COLORS.ASSIST
    back = () => setStep({ type: "GOAL_FLOW", phase: "scorer" })
    const finish = async (assisterId: string | null) => {
      if (onGoal && await onGoal(scorerId, assisterId, null, stepAt(), { huck, zone })) setStep(null)
    }
    body = (
      <>
        {tagRow({ huck: true, zone: true })}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sortedLine.filter(p => p.id !== scorerId).map(p => (
            <PlayerTile
              key={p.id}
              player={p}
              disabled={busy}
              onClick={() => askHockey ? setStep({ type: "GOAL_FLOW", phase: "hockey", scorerId, assisterId: p.id }) : finish(p.id)}
            />
          ))}
          <Button variant="outline" disabled={busy} onClick={() => finish(null)} className="h-auto min-h-12 whitespace-normal">
            No assist (Callahan)
          </Button>
        </div>
        <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={askHockey} onChange={toggleHockey} className="size-4 accent-foreground" />
          Also ask for the hockey assist
        </label>
      </>
    )
  } else if (step.type === "GOAL_FLOW") {
    const { scorerId, assisterId } = step
    const assister = linePool.find(p => p.id === assisterId)
    heading = `Hockey assist: who threw to ${assister ? assister.first_name : "them"}?`
    headingColor = EVENT_TYPE_COLORS.HOCKEY_ASSIST
    back = () => setStep({ type: "GOAL_FLOW", phase: "assist", scorerId })
    const finish = async (hockeyId: string | null) => {
      if (onGoal && await onGoal(scorerId, assisterId, hockeyId, stepAt(), { huck, zone })) setStep(null)
    }
    body = (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Button disabled={busy} onClick={() => finish(null)} className="h-auto min-h-12 whitespace-normal">
          None · finish point
        </Button>
        {sortedLine.filter(p => p.id !== assisterId).map(p => (
          <PlayerTile key={p.id} player={p} disabled={busy} onClick={() => finish(p.id)} />
        ))}
      </div>
    )
  } else if (step.type === "TURNOVER" && !step.turnoverType) {
    heading = "Turnover: what happened?"
    headingColor = EVENT_TYPE_COLORS.TURNOVER
    body = (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TURNOVER_TYPES.map(t => (
          <Button key={t} variant="outline" size="touch" disabled={busy} onClick={() => setStep({ type: "TURNOVER", turnoverType: t })}>
            {TURNOVER_TYPE_LABELS[t]}
          </Button>
        ))}
      </div>
    )
  } else if (step.type === "TURNOVER") {
    const turnoverType = step.turnoverType!
    heading = `${TURNOVER_TYPE_LABELS[turnoverType]}: ${TURNOVER_WHO[turnoverType]}`
    headingColor = EVENT_TYPE_COLORS.TURNOVER
    back = () => setStep({ type: "TURNOVER" })
    body = sortedLine.length === 0 ? emptyLine : (
      <>
        {tagRow({ huck: true, zone: true })}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sortedLine.map(p => (
            <PlayerTile key={p.id} player={p} disabled={busy} onClick={() => log("TURNOVER", { playerId: p.id, turnoverType })} />
          ))}
        </div>
      </>
    )
  } else if (step.type === "OPP_TURNOVER") {
    heading = `${opponent} turned it: how?`
    headingColor = EVENT_TYPE_COLORS.OPP_TURNOVER
    body = (
      <>
      {tagRow({ zone: true })}
      <div className="grid grid-cols-2 gap-2">
        {OPP_TURNOVER_TYPES.map(t => (
          <Button key={t} variant="outline" size="touch" disabled={busy} onClick={() => log("OPP_TURNOVER", { turnoverType: t })}>
            {TURNOVER_TYPE_LABELS[t]}
          </Button>
        ))}
      </div>
      </>
    )
  } else if (step.type === "TIMEOUT") {
    heading = "Timeout: which team?"
    headingColor = EVENT_TYPE_COLORS.TIMEOUT
    body = (
      <div className="grid grid-cols-2 gap-2">
        {(["VOID", "OPP"] as const).map(t => (
          <Button key={t} variant="outline" size="touch" disabled={busy} onClick={() => log("TIMEOUT", { team: t })} className="min-w-0">
            <span className="truncate">{t === "VOID" ? "VOID" : opponent}</span>
          </Button>
        ))}
      </div>
    )
  } else if (step.type === "SUBSTITUTION" && step.phase === "out") {
    heading = "Sub: who is going out?"
    headingColor = EVENT_TYPE_COLORS.SUBSTITUTION
    body = sortedLine.length === 0 ? emptyLine : (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sortedLine.map(p => (
          <PlayerTile key={p.id} player={p} disabled={busy} onClick={() => setStep({ type: "SUBSTITUTION", phase: "in", playerOutId: p.id })} />
        ))}
      </div>
    )
  } else if (step.type === "SUBSTITUTION") {
    const out = linePool.find(p => p.id === step.playerOutId)
    const outId = step.playerOutId
    heading = `Sub: who replaces ${out ? fullName(out) : "them"}?`
    headingColor = EVENT_TYPE_COLORS.SUBSTITUTION
    back = () => setStep({ type: "SUBSTITUTION", phase: "out" })
    const bench = [...benchPool].sort(byDisplayName)
    body = bench.length === 0 ? (
      <p className="py-4 text-sm text-fg-muted">Everyone attending is already on the line.</p>
    ) : (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {bench.map(p => (
          <PlayerTile key={p.id} player={p} disabled={busy} onClick={() => log("SUBSTITUTION", { playerId: outId, playerInId: p.id })} />
        ))}
      </div>
    )
  } else {
    const type = step.type
    heading = `${EVENT_TYPE_LABELS[type]}: who?`
    headingColor = EVENT_TYPE_COLORS[type]
    body = sortedLine.length === 0 ? emptyLine : (
      <>
        {tagRow({ huck: HUCKABLE_TYPES.includes(type), zone: ZONABLE_TYPES.includes(type) })}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sortedLine.map(p => (
            <PlayerTile key={p.id} player={p} disabled={busy} onClick={() => log(type, { playerId: p.id })} />
          ))}
        </div>
      </>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" className="-ml-2 h-10" onClick={back} disabled={busy}>
          <ChevronLeft /> Back
        </Button>
        <p className={cn("text-sm font-medium", headingColor)}>{heading}</p>
      </div>
      {body}
      <p aria-live="polite" className="mt-2 h-4 text-xs text-fg-muted">{busy ? "Saving…" : ""}</p>
    </div>
  )
}
