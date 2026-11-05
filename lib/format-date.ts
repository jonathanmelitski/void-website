/**
 * Timezone-safe date labels.
 *
 * Event and newsletter dates are stored as date-only strings ("2026-10-24"). `new Date("2026-10-24")`
 * parses that as UTC midnight, which shows as the previous day anywhere west of UTC. Date-only
 * strings are parsed into local calendar parts instead; full timestamps are parsed normally.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

type DateInput = string | number | Date | null | undefined

/** Parses "YYYY-MM-DD" as a local calendar date; anything else via `new Date()`. Null if invalid. */
export function parseDate(value: DateInput): Date | null {
  if (value == null || value === "") return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value.trim())
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

/** "May 1, 2026" by default. Returns "" for missing/invalid input. */
export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" }
): string {
  const d = parseDate(value)
  return d ? d.toLocaleDateString("en-US", options) : ""
}

/** Machine-readable value for <time dateTime>: "YYYY-MM-DD" for date-only input, ISO otherwise. */
export function toDateTimeAttr(value: DateInput): string | undefined {
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) return value.trim()
  const d = parseDate(value)
  return d ? d.toISOString() : undefined
}

/** Event-date alias of parseDate (string input). */
export function parseEventDate(value: string | null | undefined): Date | null {
  return parseDate(value)
}

/** "October 24, 2026" by default. Returns the raw value if it can't be parsed. */
export function formatEventDate(value: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  return parseDate(value) ? formatDate(value, opts) : (value ?? "")
}

/** Game start time: "Sat 9:00 AM". Empty string when missing or invalid. */
export function formatGameTime(value: string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })
}
