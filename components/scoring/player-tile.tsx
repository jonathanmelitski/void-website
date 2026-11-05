"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PlayerItem } from "@/lib/aws/players"

/**
 * One player target for the scoring console. Name first (a dozen players wear #0), number second.
 * 48px tall, names wrap instead of truncating, and selecting never changes the tile's size, so
 * nothing moves under the next tap.
 */
export function PlayerTile({
  player,
  selected,
  onClick,
  disabled,
  highlighted,
  className,
}: {
  player: PlayerItem
  /** undefined = a plain pick target (no checkbox semantics) */
  selected?: boolean
  onClick: () => void
  disabled?: boolean
  /** Keyboard "Enter picks this one" hint for the top filter match. */
  highlighted?: boolean
  className?: string
}) {
  const toggle = selected !== undefined
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={toggle ? selected : undefined}
      className={cn(
        "flex min-h-12 w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-50 touch-manipulation",
        selected
          ? "border-brand bg-brand/15 text-foreground"
          : "border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-2",
        highlighted && "ring-2 ring-brand/60",
        className
      )}
    >
      {toggle && (
        <span
          aria-hidden
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-brand bg-brand text-brand-foreground" : "border-border-strong"
          )}
        >
          {selected && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      )}
      <span className="min-w-0 flex-1 font-medium leading-tight break-words">
        {player.first_name} {player.last_name}
      </span>
      <span className="shrink-0 font-mono tabular-nums text-xs text-fg-muted">#{player.number}</span>
    </button>
  )
}
