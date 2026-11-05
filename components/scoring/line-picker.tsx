"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Hash, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import type { PlayerItem } from "@/lib/aws/players"
import { PlayerTile } from "./player-tile"
import { byDisplayName, matchesPlayer } from "./shared"

export type LinePreset = {
  key: string
  label: string
  /** null/empty = no such line yet (button disabled) */
  ids: string[] | null
}

/**
 * Pick the players on the line, built around finding 7 of ~33 fast:
 * - sticky filter (name or number; "#" switches a phone to the number keypad; Enter toggles the top match)
 * - presets ("Same as last point", "Last O-line", "Last D-line") fill the line in one tap
 * - a fixed-size "On the line (n/7)" tray; the pool below never reorders or changes size on selection
 */
export function LinePicker({
  pool,
  selected,
  onChange,
  presets,
  target = 7,
  stickyClassName = "top-[7.5rem] bg-background",
  autoFocus = false,
  captureTyping = false,
  emptyPool,
  disabled,
}: {
  pool: PlayerItem[]
  selected: string[]
  onChange: (ids: string[]) => void
  presets?: LinePreset[]
  target?: number
  /** Sticky offset + opaque background for the filter/tray strip (sits under navbar + score bar). */
  stickyClassName?: string
  /** Focus the filter on devices with a keyboard (never pops the phone keyboard). */
  autoFocus?: boolean
  /** Desktop: typing anywhere on the page goes to the filter. */
  captureTyping?: boolean
  emptyPool?: React.ReactNode
  disabled?: boolean
}) {
  const [query, setQuery] = useState("")
  const [numeric, setNumeric] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const sortedPool = useMemo(() => [...pool].sort(byDisplayName), [pool])
  const byId = useMemo(() => new Map(pool.map(p => [p.id, p])), [pool])
  const matches = useMemo(() => sortedPool.filter(p => matchesPlayer(p, query)), [sortedPool, query])
  const selectedSet = new Set(selected)
  const topMatch = query.trim() ? matches[0] : undefined

  useEffect(() => {
    if (!autoFocus) return
    if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus()
  }, [autoFocus])

  // Desktop: start typing a name anywhere and it lands in the filter.
  useEffect(() => {
    if (!captureTyping || disabled) return
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === " ") return
      const t = e.target as HTMLElement | null
      if (t && (t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog']"))) return
      e.preventDefault()
      setQuery(q => q + e.key)
      inputRef.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [captureTyping, disabled])

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      if (topMatch) {
        toggle(topMatch.id)
        setQuery("")
      }
    } else if (e.key === "Escape" && query) {
      e.stopPropagation()
      setQuery("")
    }
  }

  const count = selected.length
  const countTone = count === target ? "text-success" : count > target ? "text-warning" : "text-fg-secondary"
  // Fixed number of tray slots so the tray never changes height; extra players fold into the last slot.
  const slots = Array.from({ length: target }, (_, i) => {
    if (count > target && i === target - 1) return { kind: "more" as const, n: count - (target - 1) }
    const id = selected[i]
    return id ? { kind: "player" as const, id } : { kind: "empty" as const }
  })

  return (
    <div className="flex flex-col gap-3">
      {presets && presets.length > 0 && (
        <div role="group" aria-label="Line shortcuts" className="flex flex-wrap gap-2">
          {presets.map(p => {
            const ids = (p.ids ?? []).filter(id => byId.has(id))
            return (
              <Button
                key={p.key}
                type="button"
                variant="outline"
                size="sm"
                className="h-10"
                disabled={disabled || ids.length === 0}
                onClick={() => onChange(ids)}
              >
                {p.label}
              </Button>
            )
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            disabled={disabled || count === 0}
            onClick={() => onChange([])}
          >
            Clear
          </Button>
        </div>
      )}

      <div className={cn("sticky z-20 -mx-1 flex flex-col gap-2 rounded-md px-1 py-2", stickyClassName)}>
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Find a player by name or number</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
            <input
              ref={inputRef}
              type="text"
              inputMode={numeric ? "numeric" : "search"}
              enterKeyHint="done"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={query}
              disabled={disabled}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={e => e.currentTarget.select()}
              placeholder={numeric ? "Jersey number" : "Name or number"}
              className="h-12 w-full rounded-md border border-input bg-surface pl-9 pr-10 text-base text-foreground placeholder:text-fg-muted"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => { setQuery(""); inputRef.current?.focus() }}
                className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </label>
          <Button
            type="button"
            variant={numeric ? "secondary" : "outline"}
            size="icon-touch"
            aria-label="Number keypad"
            aria-pressed={numeric}
            disabled={disabled}
            onClick={() => { setNumeric(n => !n); inputRef.current?.focus() }}
          >
            <Hash />
          </Button>
        </div>

        <div>
          <div className="mb-1.5 flex h-5 items-center justify-between text-xs">
            <span className="font-medium text-fg-secondary">On the line</span>
            <span aria-live="polite" className={cn("font-mono tabular-nums", countTone)}>
              {count}/{target}
              <span className="sr-only"> selected</span>
            </span>
          </div>
          <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" aria-label="Players on the line">
            {slots.map((s, i) => (
              <li key={s.kind === "player" ? s.id : `slot-${i}`} className="min-w-0">
                {s.kind === "player" ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(s.id)}
                    aria-label={`Remove ${byId.get(s.id)?.first_name ?? "player"} ${byId.get(s.id)?.last_name ?? ""} from the line`}
                    className="flex h-10 w-full items-center gap-1 rounded-md border border-brand/50 bg-brand/15 px-2 text-left text-xs font-medium text-foreground hover:bg-brand/25"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {byId.get(s.id)?.first_name ?? "?"} {byId.get(s.id)?.last_name?.charAt(0) ?? ""}
                    </span>
                    <X aria-hidden className="size-3 shrink-0 text-fg-muted" />
                  </button>
                ) : s.kind === "more" ? (
                  <div className="flex h-10 items-center justify-center rounded-md border border-warning/40 bg-warning/10 text-xs font-medium text-warning">
                    +{s.n}
                  </div>
                ) : (
                  <div aria-hidden className="h-10 rounded-md border border-dashed border-border" />
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {pool.length === 0 ? (
        emptyPool ?? <p className="text-sm text-fg-muted">No players to pick from.</p>
      ) : matches.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">No player matches “{query.trim()}”.</p>
      ) : (
        <>
          {topMatch && (
            <p className="hidden text-xs text-fg-muted pointer-fine:block">
              <Kbd>Enter</Kbd> {selectedSet.has(topMatch.id) ? "removes" : "adds"} {topMatch.first_name} {topMatch.last_name}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {matches.map(p => (
              <PlayerTile
                key={p.id}
                player={p}
                selected={selectedSet.has(p.id)}
                highlighted={topMatch?.id === p.id}
                disabled={disabled}
                onClick={() => toggle(p.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
