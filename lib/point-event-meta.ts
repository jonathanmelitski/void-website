// Client-safe point event definitions (no AWS imports) shared by the API, scorer and film editor.

// PULL_FINISHED: the pull lands or is fielded — a precise anchor for syncing a point to film
// TAP_IN: play restarts after a stoppage (timeout, injury sub) — another film-sync anchor
export type PointEventType =
  | "GOAL" | "ASSIST" | "HOCKEY_ASSIST" | "TURNOVER" | "BLOCK" | "PULL" | "PULL_FINISHED" | "SUBSTITUTION" | "TIMEOUT" | "TAP_IN" | "OPP_TURNOVER"

export const POINT_EVENT_TYPES: readonly PointEventType[] = [
  "GOAL", "ASSIST", "HOCKEY_ASSIST", "TURNOVER", "BLOCK", "PULL", "PULL_FINISHED", "SUBSTITUTION", "TIMEOUT", "TAP_IN", "OPP_TURNOVER",
]

// Event types recorded without an acting player
// OPP_TURNOVER: the opponent gave it up without a VOID block (their throwaway, drop, stall)
export const PLAYERLESS_EVENT_TYPES: readonly PointEventType[] = ["TIMEOUT", "PULL_FINISHED", "TAP_IN", "OPP_TURNOVER"]

export type PointEventMeta = {
  label: string
  short: string      // chip label in the timeline editor
  hotkey: string     // film editor: add this event at the playhead
  dot: string        // solid color (ticks, chip accents)
  text: string       // text color
  lane: "play" | "stoppage"
}

export const POINT_EVENT_META: Record<PointEventType, PointEventMeta> = {
  PULL:          { label: "Pull",          short: "Pull",  hotkey: "p", dot: "bg-slate-300",  text: "text-slate-300",  lane: "play" },
  PULL_FINISHED: { label: "Pull Finished", short: "Pull Finished", hotkey: "f", dot: "bg-cyan-400",   text: "text-cyan-400",   lane: "play" },
  TURNOVER:      { label: "Turnover",      short: "Turn",  hotkey: "t", dot: "bg-red-400",    text: "text-red-400",    lane: "play" },
  OPP_TURNOVER:  { label: "They turned it", short: "Their turn", hotkey: "x", dot: "bg-emerald-400", text: "text-emerald-400", lane: "play" },
  BLOCK:         { label: "Block",         short: "Block", hotkey: "b", dot: "bg-yellow-400", text: "text-yellow-400", lane: "play" },
  ASSIST:        { label: "Assist",        short: "Ast",   hotkey: "a", dot: "bg-blue-400",   text: "text-blue-400",   lane: "play" },
  HOCKEY_ASSIST: { label: "Hockey assist", short: "HA",    hotkey: "h", dot: "bg-indigo-400", text: "text-indigo-400", lane: "play" },
  GOAL:          { label: "Goal",          short: "Goal",  hotkey: "g", dot: "bg-green-400",  text: "text-green-400",  lane: "play" },
  SUBSTITUTION:  { label: "Sub",           short: "Sub",   hotkey: "s", dot: "bg-purple-400", text: "text-purple-400", lane: "stoppage" },
  TIMEOUT:       { label: "Timeout",       short: "TO",    hotkey: "o", dot: "bg-orange-400", text: "text-orange-400", lane: "stoppage" },
  TAP_IN:        { label: "Tapped in",     short: "Tap in", hotkey: "i", dot: "bg-sky-400",   text: "text-sky-400",    lane: "stoppage" },
}

/** A pull by the other team (team "OPP") has no Void player. */
export function eventNeedsPlayer(type: PointEventType, team?: "VOID" | "OPP") {
  if (type === "PULL" && team === "OPP") return false
  return !PLAYERLESS_EVENT_TYPES.includes(type)
}

export type PullResult = "IN" | "OUT"

/** Thrown deep. Goals (and their assist) and turnovers. */
export const HUCKABLE_TYPES: readonly PointEventType[] = ["GOAL", "ASSIST", "TURNOVER"]

/**
 * Field zone, always from VOID's attacking direction: OWN = the third VOID defends, RED = the third
 * VOID attacks (the red zone). Goals/assists: where the scoring throw came from. Turnovers: where VOID
 * lost it. Blocks / their turnovers: where VOID got it back.
 */
export type FieldZone = "OWN" | "MID" | "RED"
export const FIELD_ZONES: readonly FieldZone[] = ["OWN", "MID", "RED"]
export const FIELD_ZONE_LABELS: Record<FieldZone, string> = { OWN: "Own third", MID: "Middle", RED: "Red zone" }
export const ZONABLE_TYPES: readonly PointEventType[] = ["GOAL", "ASSIST", "TURNOVER", "OPP_TURNOVER", "BLOCK"]

/** How possession was lost. BLOCKED = the other team got a D on our throw. */
export type TurnoverType = "THROWAWAY" | "DROP" | "STALL" | "BLOCKED" | "OTHER"
export const TURNOVER_TYPES: readonly TurnoverType[] = ["THROWAWAY", "DROP", "STALL", "BLOCKED", "OTHER"]
/** The opponent's unforced turnovers (a block is our BLOCK event). */
export const OPP_TURNOVER_TYPES: readonly TurnoverType[] = ["THROWAWAY", "DROP", "STALL", "OTHER"]
export const TURNOVER_TYPE_LABELS: Record<TurnoverType, string> = {
  THROWAWAY: "Throwaway", DROP: "Drop", STALL: "Stall", BLOCKED: "Blocked", OTHER: "Other",
}
/**
 * The prompt for who gets the turnover. Neutral on purpose: a throwaway can be charged to the
 * receiver when they're mostly at fault, so any player on the line can be picked.
 */
export const TURNOVER_WHO: Record<TurnoverType, string> = {
  THROWAWAY: "who's charged?", DROP: "who dropped it?", STALL: "who was stalled?", BLOCKED: "who's charged?", OTHER: "who's charged?",
}
