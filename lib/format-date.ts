/**
 * Timezone-safe date labels.
 *
 * `new Date("2026-05-01")` parses a date-only string as UTC midnight, so in US time zones it
 * renders as the previous day. Date-only strings are parsed into local calendar parts instead;
 * full timestamps are formatted as usual.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parses "YYYY-MM-DD" as a local calendar date; anything else via `new Date()`. Null if invalid. */
export function parseDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value.trim())
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

/** "May 1, 2026" (long) or "May 1" style labels. Returns "" for missing/invalid input. */
export function formatDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" }
): string {
  const d = parseDate(value)
  return d ? d.toLocaleDateString("en-US", options) : ""
}

/** Machine-readable value for <time dateTime>: "YYYY-MM-DD" for date-only input, ISO otherwise. */
export function toDateTimeAttr(value: string | number | Date | null | undefined): string | undefined {
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) return value.trim()
  const d = parseDate(value)
  return d ? d.toISOString() : undefined
}
