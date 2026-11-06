"use client"

import { cn } from "@/lib/utils"

/**
 * Sticky at-a-glance score at the top of the console (no site navbar there; h-14, so sticky content
 * below it uses top-14).
 * Spans the console's gutters so it reads as a bar, not a card.
 */
export function ScoreBar({
  scoreVoid,
  scoreOpponent,
  opponent,
  status,
  possession,
}: {
  scoreVoid: number
  scoreOpponent: number
  opponent: string
  /** Right-hand chip: "Point 4 · O-line", "Next: point 5 · D-line", "Final". */
  status: { label: string; tone: "live" | "next" | "final" }
  /** Live point: who has the disc (a dot by that team's name). */
  possession?: "VOID" | "OPP"
}) {
  const disc = (team: "VOID" | "OPP") => possession === team && (
    <span aria-hidden className="inline-block size-2 shrink-0 self-center rounded-full bg-brand" />
  )
  return (
    <div className="sticky top-0 z-30 -mx-4 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-sm sm:-mx-8 sm:px-8">
      <p
        className="flex min-w-0 flex-1 items-baseline gap-2"
        aria-label={`VOID ${scoreVoid}, ${opponent} ${scoreOpponent}${possession ? `. ${possession === "VOID" ? "VOID" : opponent} has the disc` : ""}`}
      >
        {disc("VOID")}
        <span className="shrink-0 text-sm font-semibold text-fg-secondary">VOID</span>
        <span className="shrink-0 font-mono text-3xl font-semibold tabular-nums leading-none text-foreground">
          {scoreVoid}<span className="px-1 text-fg-muted">–</span>{scoreOpponent}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-fg-secondary">{opponent}</span>
        {disc("OPP")}
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
