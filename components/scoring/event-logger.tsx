"use client"

import { useState } from "react"
import { ChevronLeft, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { PlayerItem } from "@/lib/aws/players"
import type { PointEventType } from "@/lib/aws/point-events"
import { PlayerTile } from "./player-tile"
import {
  EVENT_TYPE_COLORS, EVENT_TYPE_LABELS, LOGGABLE_EVENT_TYPES, byDisplayName, fullName,
  type LogEventOpts, type LogStep,
} from "./shared"

/** Two-tap event logging: event type, then the player (or team for a timeout). */
export function EventLogger({
  linePool,
  benchPool,
  opponent,
  busy,
  onLog,
  onEditLine,
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
  onEditLine?: () => void
  title?: string
}) {
  const [step, setStep] = useState<LogStep>(null)

  async function log(type: PointEventType, opts: LogEventOpts) {
    if (await onLog(type, opts)) setStep(null)
  }

  if (step === null) {
    return (
      <div>
        <p className="mb-2 text-xs font-medium text-fg-muted">{title}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {LOGGABLE_EVENT_TYPES.map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setStep(type === "SUBSTITUTION" ? { type, phase: "out" } : { type } as LogStep)}
              disabled={busy}
              className={cn(
                "h-12 rounded-md border border-border bg-surface text-sm font-medium transition-colors hover:bg-surface-2 active:scale-95 disabled:opacity-50 touch-manipulation",
                EVENT_TYPE_COLORS[type]
              )}
            >
              {EVENT_TYPE_LABELS[type]}
            </button>
          ))}
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

  if (step.type === "TIMEOUT") {
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sortedLine.map(p => (
          <PlayerTile key={p.id} player={p} disabled={busy} onClick={() => log(type, { playerId: p.id })} />
        ))}
      </div>
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
