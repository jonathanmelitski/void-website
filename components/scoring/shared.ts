import type { PlayerItem } from "@/lib/aws/players"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"

// Scoring writes go through apiFetch: an expired session opens the in-place sign-in sheet and the
// write continues after sign-in (waitForSession). Failures surface inline instead of being dropped.
// Hook point for the future offline queue: these handlers are where mutations would be enqueued.
export const SCORING_WRITE = { waitForSession: true } as const

export function writeErrorText(err: unknown, fallback: string): string {
  return err instanceof Error && (err.name === "NetworkError" || err.name === "SessionExpiredError") ? err.message : fallback
}

/** Scoring toasts sit at the top so they never cover the thumb-zone action bar. */
export const SCORING_TOAST = { position: "top-center" } as const

export const EVENT_TYPE_LABELS: Record<PointEventType, string> = {
  GOAL: "Goal",
  ASSIST: "Assist",
  TURNOVER: "Turnover",
  BLOCK: "Block",
  PULL: "Pull",
  PULL_FINISHED: "Pull Finished",
  SUBSTITUTION: "Sub",
  TIMEOUT: "Timeout",
}

export const EVENT_TYPE_COLORS: Record<PointEventType, string> = {
  GOAL: "text-success",
  ASSIST: "text-brand-text",
  TURNOVER: "text-destructive",
  BLOCK: "text-warning",
  PULL: "text-fg-muted",
  PULL_FINISHED: "text-brand-text",
  SUBSTITUTION: "text-brand-text",
  TIMEOUT: "text-warning",
}

/** Event types the scorer can log by hand (PULL_FINISHED is a film-sync marker). */
export const LOGGABLE_EVENT_TYPES = (Object.keys(EVENT_TYPE_LABELS) as PointEventType[]).filter(t => t !== "PULL_FINISHED")

export type LogStep =
  | null
  | { type: "GOAL" | "ASSIST" | "TURNOVER" | "BLOCK" | "PULL" }
  | { type: "TIMEOUT" }
  | { type: "SUBSTITUTION"; phase: "out" }
  | { type: "SUBSTITUTION"; phase: "in"; playerOutId: string }

export type LogEventOpts = { playerId?: string; playerInId?: string; team?: "VOID" | "OPP" }

export function fullName(p: PlayerItem) {
  return `${p.first_name} ${p.last_name}`.trim()
}

/** Name lookup against the full roster (not just attending players), so old lines never read "Unknown". */
export function makePlayerName(players: PlayerItem[]) {
  const byId = new Map(players.map(p => [p.id, p]))
  return (id: string | undefined) => {
    if (!id) return ""
    const p = byId.get(id)
    return p ? fullName(p) : "Unknown player"
  }
}

export function eventDetail(ev: PointEventItem, name: (id: string | undefined) => string, opponent = "Opponent"): string {
  if (ev.eventType === "TIMEOUT") return ev.team === "VOID" ? "VOID" : opponent
  if (ev.eventType === "SUBSTITUTION") return `${name(ev.playerId)} → ${ev.playerInId ? name(ev.playerInId) : "?"}`
  return name(ev.playerId)
}

export function sortEvents(events: PointEventItem[]) {
  return [...events].sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Next sortOrder for a point: max + 1, so a delete never leads to two events sharing an index. */
export function nextSortOrder(events: PointEventItem[]) {
  return events.reduce((m, e) => Math.max(m, e.sortOrder), 0) + 1
}

/** Players sorted by the name the tiles show, so the eye scans one alphabet. */
export function byDisplayName(a: PlayerItem, b: PlayerItem) {
  return a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name)
}

/** Filter by jersey number prefix (digits) or by the start of any name word. */
export function matchesPlayer(p: PlayerItem, raw: string) {
  const q = raw.trim().toLowerCase().replace(/^#/, "")
  if (!q) return true
  if (/^\d+$/.test(q)) return String(p.number).startsWith(q)
  const hay = `${p.first_name} ${p.last_name} ${p.jersey_name_text ?? ""}`.toLowerCase()
  if (hay.includes(q) && q.includes(" ")) return true
  return hay.split(/[\s-]+/).some(w => w.startsWith(q))
}
