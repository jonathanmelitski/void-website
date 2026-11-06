import type { PlayerItem } from "@/lib/aws/players"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"
import { TURNOVER_TYPE_LABELS, type TurnoverType } from "@/lib/point-event-meta"

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
  HOCKEY_ASSIST: "Hockey assist",
  TURNOVER: "Turnover",
  BLOCK: "Block",
  PULL: "Pull",
  PULL_FINISHED: "Pull Finished",
  SUBSTITUTION: "Sub",
  TIMEOUT: "Timeout",
  TAP_IN: "Tapped in",
  OPP_TURNOVER: "They turned it",
}

export const EVENT_TYPE_COLORS: Record<PointEventType, string> = {
  GOAL: "text-success",
  ASSIST: "text-brand-text",
  HOCKEY_ASSIST: "text-brand-text",
  TURNOVER: "text-destructive",
  BLOCK: "text-warning",
  PULL: "text-fg-muted",
  PULL_FINISHED: "text-brand-text",
  SUBSTITUTION: "text-brand-text",
  TIMEOUT: "text-warning",
  TAP_IN: "text-brand-text",
  OPP_TURNOVER: "text-success",
}

/** Event types the scorer can log from the grid (PULL_FINISHED and TAP_IN are film-sync markers with their own buttons). */
export const LOGGABLE_EVENT_TYPES = (Object.keys(EVENT_TYPE_LABELS) as PointEventType[]).filter(t => t !== "PULL_FINISHED" && t !== "TAP_IN")

/** Live point: the pull has its own hold button, and the assist is asked as part of Goal. */
export const LIVE_GRID_TYPES = LOGGABLE_EVENT_TYPES.filter(t => t !== "PULL" && t !== "ASSIST" && t !== "HOCKEY_ASSIST")

/**
 * A logging step. `at` is when the first button of the sequence was tapped (ms since epoch): the
 * event's time for film sync, kept through the follow-up taps (who? which team?).
 */
export type LogStep =
  | null
  | ((
    | { type: "GOAL" | "ASSIST" | "HOCKEY_ASSIST" | "BLOCK" | "PULL" }
    /** No turnoverType yet: pick the type first, then who. */
    | { type: "TURNOVER"; turnoverType?: TurnoverType }
    | { type: "OPP_TURNOVER" }
    | { type: "TIMEOUT" }
    | { type: "SUBSTITUTION"; phase: "out" }
    | { type: "SUBSTITUTION"; phase: "in"; playerOutId: string }
    | { type: "GOAL_FLOW"; phase: "scorer" }
    | { type: "GOAL_FLOW"; phase: "assist"; scorerId: string }
    | { type: "GOAL_FLOW"; phase: "hockey"; scorerId: string; assisterId: string }
  ) & { at?: number })

/** occurredAt: ISO time of the first tap of the sequence (see LogStep.at). */
export type LogEventOpts = { playerId?: string; playerInId?: string; team?: "VOID" | "OPP"; occurredAt?: string; turnoverType?: TurnoverType }

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
  if (ev.eventType === "PULL") {
    const who = ev.team === "OPP" ? opponent : name(ev.playerId) || "VOID"
    return [who, ev.pullResult === "IN" ? "In" : ev.pullResult === "OUT" ? "Out" : null,
      ev.hangTimeMs !== undefined ? `${(ev.hangTimeMs / 1000).toFixed(1)} s` : null].filter(Boolean).join(" · ")
  }
  if (ev.eventType === "PULL_FINISHED" || ev.eventType === "TAP_IN") return ""
  if (ev.eventType === "OPP_TURNOVER") return ev.turnoverType ? TURNOVER_TYPE_LABELS[ev.turnoverType] : ""
  if (ev.eventType === "TURNOVER" && ev.turnoverType) return `${name(ev.playerId)} · ${TURNOVER_TYPE_LABELS[ev.turnoverType]}`
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
