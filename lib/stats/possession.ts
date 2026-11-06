// Possession, derived from a point's events (pure; client-safe). Nothing about possession is stored:
// it follows from who starts with the disc and the events that change it, so editing an event in the
// console or in film can't leave a stale "who has it" behind.
//
//   start          O-line point → VOID receives the pull; D-line → the opponent does
//   TURNOVER       VOID loses it            (any type: throwaway, drop, stall, blocked, other)
//   BLOCK          VOID wins it             (our D)
//   OPP_TURNOVER   VOID wins it             (their unforced error: throwaway, drop, stall)
//   GOAL           VOID scores: point over
//   point scored by the opponent (stored/derived outcome) ends their possession
//
// Break chances: every VOID possession on a D-line point is a chance to break; the last one is
// converted when VOID scores. The opponent's break chances are their possessions on our O-line points.

import type { PointLineType } from "../aws/points"
import type { PointEventType } from "../point-event-meta"

export type DiscTeam = "VOID" | "OPP"

/** sortOrder orders a point's events; without it, the order given is used. */
export type PossessionEvent = { id: string; pointId: string; eventType: PointEventType; sortOrder?: number }
export type PossessionPoint = { id: string; lineType: PointLineType }

export type Possession = {
  team: DiscTeam
  /** Event that started it (null for the first possession of the point). */
  startEventId: string | null
  /** Event that ended it (null while it's still going, or when the point ended without one). */
  endEventId: string | null
}

export type PointPossessions = {
  pointId: string
  lineType: PointLineType
  possessions: Possession[]
  /** Who has the disc after the last event (for a live point). */
  current: DiscTeam
  /** A turnover or block that didn't fit (e.g. two VOID turnovers in a row). */
  inconsistent: boolean
}

const changesTo: Partial<Record<PointEventType, DiscTeam>> = {
  TURNOVER: "OPP",
  BLOCK: "VOID",
  OPP_TURNOVER: "VOID",
}

export function pointPossessions(point: PossessionPoint, events: readonly PossessionEvent[]): PointPossessions {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.pointId === point.id)
    .sort((a, b) => (a.e.sortOrder ?? a.i) - (b.e.sortOrder ?? b.i) || a.i - b.i)
    .map(({ e }) => e)
  let current: DiscTeam = point.lineType === "O" ? "VOID" : "OPP"
  const possessions: Possession[] = [{ team: current, startEventId: null, endEventId: null }]
  let inconsistent = false
  for (const e of sorted) {
    if (e.eventType === "GOAL") {
      possessions[possessions.length - 1].endEventId = e.id
      break
    }
    const to = changesTo[e.eventType]
    if (!to) continue
    if (to === current) { inconsistent = true; continue } // e.g. a block while we already had it
    possessions[possessions.length - 1].endEventId = e.id
    current = to
    possessions.push({ team: to, startEventId: e.id, endEventId: null })
  }
  return { pointId: point.id, lineType: point.lineType, possessions, current, inconsistent }
}

export type BreakStats = {
  /** VOID possessions on D-line points. */
  breakChances: number
  /** D-line points VOID scored (each converts exactly one chance). */
  breaks: number
  /** D-line points where VOID had the disc at least once. */
  dPointsWithChance: number
  /** Opponent possessions on VOID's O-line points. */
  oppBreakChances: number
  /** O-line points the opponent scored. */
  oppBreaks: number
  /** Breaks / break chances, 0–100; null with no chances. */
  breakConversion: number | null
  oppBreakConversion: number | null
  /** Points whose turnovers don't alternate cleanly (worth a look in film). */
  inconsistentPoints: number
}

/**
 * `scorer`: who scored each finished point (from deriveGameStats); unscored/live points count their
 * chances but no conversion.
 */
export function breakStats(
  points: readonly PossessionPoint[],
  events: readonly PossessionEvent[],
  scorer: (pointId: string) => "US" | "THEM" | null,
): BreakStats {
  const out: BreakStats = {
    breakChances: 0, breaks: 0, dPointsWithChance: 0, oppBreakChances: 0, oppBreaks: 0,
    breakConversion: null, oppBreakConversion: null, inconsistentPoints: 0,
  }
  for (const p of points) {
    const pp = pointPossessions(p, events)
    if (pp.inconsistent) out.inconsistentPoints++
    const who = scorer(p.id)
    if (p.lineType === "D") {
      // A Callahan scores without VOID ever having the disc: still one chance, converted
      const ours = Math.max(pp.possessions.filter(x => x.team === "VOID").length, who === "US" ? 1 : 0)
      out.breakChances += ours
      if (ours > 0) out.dPointsWithChance++
      if (who === "US") out.breaks++
    } else {
      out.oppBreakChances += pp.possessions.filter(x => x.team === "OPP").length
      if (who === "THEM") out.oppBreaks++
    }
  }
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null)
  out.breakConversion = pct(out.breaks, out.breakChances)
  out.oppBreakConversion = pct(out.oppBreaks, out.oppBreakChances)
  return out
}
