import type { Player } from "@/models/RosterModels"

export type RosterSort = "number" | "name"
export type RosterFilter = "all" | "captains"

/** A jersey number of 0 means the player hasn't been given one yet. */
export const hasNumber = (p: Player) => Number(p.number) > 0

export const fullName = (p: Player) => `${p.first_name} ${p.last_name}`.trim()

export const initials = (p: Player) => `${p.first_name?.[0] ?? ""}${p.last_name?.[0] ?? ""}`.toUpperCase()

/** Text printed across the back of the jersey: the nickname if there is one, else the last name. */
export const jerseyName = (p: Player) => (p.jersey_name_text?.trim() || p.last_name || "").toUpperCase()

export function playerSlug(p: Player) {
  return fullName(p)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const byName = (a: Player, b: Player) =>
  a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)

/**
 * "number": captains first, then by number, then players without a number alphabetically.
 * "name": alphabetical by last name.
 */
export function sortRoster(players: Player[], sort: RosterSort) {
  const list = [...players]
  if (sort === "name") return list.sort(byName)
  return list.sort((a, b) => {
    if (a.is_captain !== b.is_captain) return a.is_captain ? -1 : 1
    const an = hasNumber(a), bn = hasNumber(b)
    if (an !== bn) return an ? -1 : 1
    if (an && bn && a.number !== b.number) return Number(a.number) - Number(b.number)
    return byName(a, b)
  })
}

/** Matches first/last name, the name on the jersey, or the number. Exact number matches rank first. */
export function searchRoster(players: Player[], query: string) {
  const q = query.trim().toLowerCase().replace(/^#/, "")
  if (!q) return players
  const isNum = /^\d+$/.test(q)
  const hits = players.filter(p => {
    if (isNum) return hasNumber(p) && String(p.number).startsWith(q)
    const hay = `${p.first_name} ${p.last_name} ${p.jersey_name_text ?? ""}`.toLowerCase()
    return q.split(/\s+/).every(part => hay.includes(part))
  })
  if (!isNum) return hits
  return [...hits.filter(p => String(p.number) === q), ...hits.filter(p => String(p.number) !== q)]
}
