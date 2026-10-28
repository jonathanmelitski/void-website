// Client-safe point event definitions (no AWS imports) shared by the API, scorer and film editor.

// PULL_FINISHED: the pull lands or is fielded — a precise anchor for syncing a point to film
export type PointEventType =
  | "GOAL" | "ASSIST" | "TURNOVER" | "BLOCK" | "PULL" | "PULL_FINISHED" | "SUBSTITUTION" | "TIMEOUT"

export const POINT_EVENT_TYPES: readonly PointEventType[] = [
  "GOAL", "ASSIST", "TURNOVER", "BLOCK", "PULL", "PULL_FINISHED", "SUBSTITUTION", "TIMEOUT",
]

// Event types recorded without an acting player
export const PLAYERLESS_EVENT_TYPES: readonly PointEventType[] = ["TIMEOUT", "PULL_FINISHED"]

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
  BLOCK:         { label: "Block",         short: "Block", hotkey: "b", dot: "bg-yellow-400", text: "text-yellow-400", lane: "play" },
  ASSIST:        { label: "Assist",        short: "Ast",   hotkey: "a", dot: "bg-blue-400",   text: "text-blue-400",   lane: "play" },
  GOAL:          { label: "Goal",          short: "Goal",  hotkey: "g", dot: "bg-green-400",  text: "text-green-400",  lane: "play" },
  SUBSTITUTION:  { label: "Sub",           short: "Sub",   hotkey: "s", dot: "bg-purple-400", text: "text-purple-400", lane: "stoppage" },
  TIMEOUT:       { label: "Timeout",       short: "TO",    hotkey: "o", dot: "bg-orange-400", text: "text-orange-400", lane: "stoppage" },
}

export function eventNeedsPlayer(type: PointEventType) {
  return !PLAYERLESS_EVENT_TYPES.includes(type)
}
