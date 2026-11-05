// Date display helpers.
//
// Event dates are stored as date-only strings ("2026-10-24"). `new Date("2026-10-24")` parses that as
// UTC midnight, which shows as the previous day anywhere west of UTC. Parse date-only values as a
// local calendar date instead; full ISO datetimes (game scheduledTime) are parsed normally.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parses "YYYY-MM-DD" as local midnight; anything else via `new Date()`. Null when invalid. */
export function parseEventDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = DATE_ONLY.exec(value.trim())
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "October 24, 2026". Returns the raw value if it can't be parsed. */
export function formatEventDate(value: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const d = parseEventDate(value)
  if (!d) return value ?? ""
  return d.toLocaleDateString("en-US", opts ?? { year: "numeric", month: "long", day: "numeric" })
}

/** Game start time: "Sat 9:00 AM". Empty string when missing or invalid. */
export function formatGameTime(value: string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })
}
