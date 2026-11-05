"use client"

import { cn } from "@/lib/utils"

/**
 * Sticky at-a-glance score under the navbar (h-14, so sticky content below it uses top-[7.5rem]).
 * Spans the console's gutters so it reads as a bar, not a card.
 */
export function ScoreBar({
  scoreVoid,
  scoreOpponent,
  opponent,
  status,
}: {
  scoreVoid: number
  scoreOpponent: number
  opponent: string
  /** Right-hand chip: "Point 4 · O-line", "Next: point 5 · D-line", "Final". */
  status: { label: string; tone: "live" | "next" | "final" }
}) {
  return (
    <div className="sticky top-16 z-30 -mx-4 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-sm sm:-mx-8 sm:px-8">
      <p className="flex min-w-0 flex-1 items-baseline gap-2" aria-label={`VOID ${scoreVoid}, ${opponent} ${scoreOpponent}`}>
        <span className="shrink-0 text-sm font-semibold text-fg-secondary">VOID</span>
        <span className="shrink-0 font-mono text-3xl font-semibold tabular-nums leading-none text-foreground">
          {scoreVoid}<span className="px-1 text-fg-muted">–</span>{scoreOpponent}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-fg-secondary">{opponent}</span>
      </p>
      <span
        className={cn(
          "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium",
          status.tone === "live" && "border-brand/40 bg-brand/15 text-brand-text",
          status.tone === "next" && "border-border text-fg-secondary",
          status.tone === "final" && "border-border bg-surface-2 text-foreground"
        )}
      >
        {status.label}
      </span>
    </div>
  )
}
