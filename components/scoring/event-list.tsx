"use client"

import { RotateCcw, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { PointEventItem } from "@/lib/aws/point-events"
import { EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from "./shared"
import { canEditWho } from "./event-who-editor"

/**
 * A point's logged events. The remove control is always visible (no hover), 40px, and labelled.
 * Rows only disappear once the parent drops them (after the server confirms), so `pendingIds`
 * shows a spinner meanwhile. `stagedIds` (edit mode) shows rows marked for removal on Save.
 */
export function EventList({
  events,
  describe,
  onRemove,
  onRestore,
  pendingIds,
  stagedIds,
  onEdit,
  editingId,
  renderEditor,
  className,
}: {
  events: PointEventItem[]
  describe: (ev: PointEventItem) => string
  onRemove?: (ev: PointEventItem) => void
  onRestore?: (ev: PointEventItem) => void
  pendingIds?: Set<string>
  stagedIds?: Set<string>
  /** Tap a row to change who did it (not for moment-only markers; see canEditWho). */
  onEdit?: (ev: PointEventItem) => void
  editingId?: string | null
  /** Shown under the row being edited. */
  renderEditor?: (ev: PointEventItem) => React.ReactNode
  className?: string
}) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {events.map((ev, i) => {
        const label = EVENT_TYPE_LABELS[ev.eventType]
        const detail = describe(ev)
        const staged = stagedIds?.has(ev.id) ?? false
        const pending = pendingIds?.has(ev.id) ?? false
        return (
          <li key={ev.id} className="flex flex-col">
          <div className="flex min-h-10 items-center gap-3 text-sm">
            <span className="w-5 shrink-0 text-right font-mono tabular-nums text-xs text-fg-muted">{i + 1}</span>
            {onEdit && !staged && canEditWho(ev) ? (
              <button
                type="button"
                onClick={() => onEdit(ev)}
                aria-expanded={editingId === ev.id}
                aria-label={`Change who: ${label}${detail ? ` (${detail})` : ""}`}
                className="flex min-h-10 min-w-0 flex-1 items-center rounded-md text-left hover:bg-surface-2"
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className={cn("font-medium", EVENT_TYPE_COLORS[ev.eventType])}>{label}</span>
                  <span className="text-fg-secondary">{detail}</span>
                </span>
              </button>
            ) : (
              <span className={cn("flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2", staged && "line-through opacity-60")}>
                <span className={cn("font-medium", EVENT_TYPE_COLORS[ev.eventType])}>{label}</span>
                <span className="text-fg-secondary">{detail}</span>
              </span>
            )}
            {staged && onRestore ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={`Keep ${label}${detail ? ` (${detail})` : ""}`}
                onClick={() => onRestore(ev)}
              >
                <RotateCcw />
              </Button>
            ) : onRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="text-fg-muted hover:text-destructive"
                aria-label={`Remove ${label}${detail ? ` (${detail})` : ""}`}
                loading={pending}
                onClick={() => onRemove(ev)}
              >
                {!pending && <X />}
              </Button>
            ) : null}
          </div>
          {editingId === ev.id && renderEditor && <div className="pb-2 pl-8">{renderEditor(ev)}</div>}
          </li>
        )
      })}
    </ol>
  )
}
