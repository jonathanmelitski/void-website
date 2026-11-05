// Derived game stats: a pure function of (game, points, point-events, roster).
// Client-safe — no I/O, no AWS imports (type-only imports are erased at build).
//
// Film point-events are the source of truth. Who scored a point is decided, in order:
//   1. a GOAL event exists on the point            → US          ("goal-event")
//   2. else the point is COMPLETE                   → stored outcome ("point-outcome")
//   3. else the next point is pointNumber+1 and starts with the opponent exactly +1
//      and our score unchanged (stored scoreBefore)  → THEM        ("inferred-next-score")
//   4. else                                          → unscored    ("unscored")
// The score is a running count of scored points; per-point scoreBefore is recomputed, never read.
// Stored caches (game.scoreVoid/scoreOpponent/result, point.voidScoreBefore) are left untouched.

import type { GameItem, GameResult, GameStatus } from "../aws/games"
import type { PointItem, PointLineType, PointOutcome } from "../aws/points"
import type { PointEventItem } from "../aws/point-events"
import type { PlayerItem } from "../aws/players"

export type Side = "US" | "THEM"
export type Score = { us: number; them: number }
export type ScorerSource = "goal-event" | "point-outcome" | "inferred-next-score" | "unscored"

export type StatsGame = Pick<GameItem, "id" | "status" | "scoreVoid" | "scoreOpponent"> & Partial<Pick<GameItem, "result" | "cap">>
export type StatsPoint = Pick<PointItem, "id" | "pointNumber" | "lineType" | "outcome" | "status" | "voidScoreBefore" | "opponentScoreBefore"> & Partial<Pick<PointItem, "playerIds">>
export type StatsEvent = Pick<PointEventItem, "id" | "pointId" | "eventType" | "playerId">
export type StatsPlayer = Pick<PlayerItem, "id" | "first_name" | "last_name"> & Partial<Pick<PlayerItem, "number">>

export type DerivedPoint = {
  id: string
  pointNumber: number
  lineType: PointLineType
  scorer: Side | null
  source: ScorerSource
  // HOLD/BREAK from the receiving team's view (same semantics as PointItem.outcome); null when unscored
  outcome: Exclude<PointOutcome, "IN_PROGRESS"> | null
  scoreBefore: Score
  scoreAfter: Score
  goalCount: number
  conflict: boolean     // a GOAL event exists but the stored COMPLETE outcome says the opponent scored
  storedStatus: PointItem["status"]
}

// Counted from one team's perspective. For THEM, "oPoints" are the points they received (our D points).
export type TeamLine = {
  oPoints: number   // scored points this team started on offense
  holds: number     // of those, points this team scored
  dPoints: number   // scored points this team started on defense
  breaks: number    // of those, points this team scored
}

export type PlayerStats = {
  playerId: string
  player: StatsPlayer | null   // null when the id is not on the roster
  goals: number
  assists: number
  blocks: number
  turnovers: number
  pulls: number
  pointsPlayed: number
}

export type StatsWarningCode =
  | "missing-point" | "duplicate-point" | "no-result" | "goal-conflict"
  | "multiple-goals" | "orphan-events" | "stored-score-differs"

export type StatsWarning = { code: StatsWarningCode; pointNumber?: number; message: string }

export type GameStats = {
  gameId: string
  score: Score
  // Leader once the game is decided. Null while IN_PROGRESS, or when nothing has been scored and the game is not FINAL.
  result: GameResult | null
  storedScore: Score
  points: DerivedPoint[]
  team: { us: TeamLine; them: TeamLine }
  oEfficiency: number | null  // our holds / our O-points, 0–100 rounded; null with no O-points
  dConversion: number | null  // our breaks / our D-points, 0–100 rounded; null with no D-points
  players: PlayerStats[]      // sorted by goals+assists desc; includes players with only points played
  warnings: StatsWarning[]
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null)

function storedScorer(p: StatsPoint): Side | null {
  if (p.status !== "COMPLETE" || p.outcome === "IN_PROGRESS") return null
  const usScored = (p.outcome === "HOLD" && p.lineType === "O") || (p.outcome === "BREAK" && p.lineType === "D")
  return usScored ? "US" : "THEM"
}

function outcomeFor(lineType: PointLineType, scorer: Side): "HOLD" | "BREAK" {
  // The receiving team (O-line for us) scoring is a hold
  const receiver: Side = lineType === "O" ? "US" : "THEM"
  return scorer === receiver ? "HOLD" : "BREAK"
}

function resultOf(score: Score): GameResult {
  return score.us > score.them ? "WIN" : score.us < score.them ? "LOSS" : "TIE"
}

export function deriveGameStats(
  game: StatsGame,
  points: readonly StatsPoint[],
  events: readonly StatsEvent[],
  roster: readonly StatsPlayer[] = [],
): GameStats {
  const warnings: StatsWarning[] = []
  const pts = [...points].sort((a, b) => a.pointNumber - b.pointNumber)

  const goalsByPoint = new Map<string, number>()
  for (const e of events) {
    if (e.eventType === "GOAL") goalsByPoint.set(e.pointId, (goalsByPoint.get(e.pointId) ?? 0) + 1)
  }

  // Structural warnings: gaps and duplicates in point numbering
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1].pointNumber, cur = pts[i].pointNumber
    if (cur === prev) {
      warnings.push({ code: "duplicate-point", pointNumber: cur, message: `P${cur} appears more than once` })
    } else if (cur > prev + 1) {
      const missing = cur - prev === 2 ? `P${prev + 1}` : `P${prev + 1}–P${cur - 1}`
      warnings.push({ code: "missing-point", pointNumber: prev + 1, message: `${missing} missing` })
    }
  }

  const running: Score = { us: 0, them: 0 }
  const derived: DerivedPoint[] = pts.map((p, i) => {
    const goalCount = goalsByPoint.get(p.id) ?? 0
    const stored = storedScorer(p)
    const next = pts[i + 1]
    let scorer: Side | null
    let source: ScorerSource
    if (goalCount > 0) { scorer = "US"; source = "goal-event" }
    else if (stored !== null) { scorer = stored; source = "point-outcome" }
    else if (
      next && next.pointNumber === p.pointNumber + 1 &&
      next.opponentScoreBefore === p.opponentScoreBefore + 1 &&
      next.voidScoreBefore === p.voidScoreBefore
    ) { scorer = "THEM"; source = "inferred-next-score" }
    else { scorer = null; source = "unscored" }

    const conflict = goalCount > 0 && stored === "THEM"
    if (conflict) {
      warnings.push({ code: "goal-conflict", pointNumber: p.pointNumber, message: `P${p.pointNumber}: goal event conflicts with stored outcome (${p.outcome})` })
    }
    if (goalCount > 1) {
      warnings.push({ code: "multiple-goals", pointNumber: p.pointNumber, message: `P${p.pointNumber} has ${goalCount} goal events` })
    }

    const scoreBefore = { ...running }
    if (scorer === "US") running.us++
    else if (scorer === "THEM") running.them++

    return {
      id: p.id,
      pointNumber: p.pointNumber,
      lineType: p.lineType,
      scorer,
      source,
      outcome: scorer ? outcomeFor(p.lineType, scorer) : null,
      scoreBefore,
      scoreAfter: { ...running },
      goalCount,
      conflict,
      storedStatus: p.status,
    }
  })

  // An unscored point is expected only for the point currently being played
  derived.forEach((d, i) => {
    const isLivePoint = i === derived.length - 1 && game.status === "IN_PROGRESS"
    if (d.scorer === null && !isLivePoint) {
      warnings.push({ code: "no-result", pointNumber: d.pointNumber, message: `P${d.pointNumber} has no result` })
    }
  })

  // Team stats, each side from its own perspective
  const us: TeamLine = { oPoints: 0, holds: 0, dPoints: 0, breaks: 0 }
  const them: TeamLine = { oPoints: 0, holds: 0, dPoints: 0, breaks: 0 }
  for (const d of derived) {
    if (!d.scorer) continue
    if (d.lineType === "O") {
      us.oPoints++; them.dPoints++
      if (d.scorer === "US") us.holds++
      else them.breaks++
    } else {
      us.dPoints++; them.oPoints++
      if (d.scorer === "US") us.breaks++
      else them.holds++
    }
  }

  // Player stats: every event on an existing point, regardless of point status
  const pointIds = new Set(pts.map(p => p.id))
  const rosterById = new Map(roster.map(p => [p.id, p]))
  const byPlayer = new Map<string, PlayerStats>()
  const statFor = (playerId: string) => {
    let s = byPlayer.get(playerId)
    if (!s) {
      s = { playerId, player: rosterById.get(playerId) ?? null, goals: 0, assists: 0, blocks: 0, turnovers: 0, pulls: 0, pointsPlayed: 0 }
      byPlayer.set(playerId, s)
    }
    return s
  }
  let orphans = 0
  for (const e of events) {
    if (!pointIds.has(e.pointId)) { orphans++; continue }
    if (!e.playerId) continue
    switch (e.eventType) {
      case "GOAL": statFor(e.playerId).goals++; break
      case "ASSIST": statFor(e.playerId).assists++; break
      case "BLOCK": statFor(e.playerId).blocks++; break
      case "TURNOVER": statFor(e.playerId).turnovers++; break
      case "PULL": statFor(e.playerId).pulls++; break
    }
  }
  if (orphans > 0) {
    warnings.push({ code: "orphan-events", message: `${orphans} event${orphans === 1 ? "" : "s"} belong to deleted points and are not counted` })
  }
  for (const p of pts) {
    for (const id of new Set(p.playerIds ?? [])) statFor(id).pointsPlayed++
  }
  const players = [...byPlayer.values()].sort(
    (a, b) => (b.goals + b.assists) - (a.goals + a.assists) || b.pointsPlayed - a.pointsPlayed,
  )

  const score = { ...running }
  const storedScore = { us: game.scoreVoid ?? 0, them: game.scoreOpponent ?? 0 }
  if (storedScore.us !== score.us || storedScore.them !== score.them) {
    warnings.push({
      code: "stored-score-differs",
      message: `Stored score ${storedScore.us}–${storedScore.them} differs from the point record (${score.us}–${score.them})`,
    })
  }

  const scoredCount = derived.filter(d => d.scorer).length
  const status: GameStatus = game.status
  const result = status === "IN_PROGRESS" ? null
    : status === "FINAL" || scoredCount > 0 ? resultOf(score)
    : null

  return {
    gameId: game.id,
    score,
    result,
    storedScore,
    points: derived,
    team: { us, them },
    oEfficiency: pct(us.holds, us.oPoints),
    dConversion: pct(us.breaks, us.dPoints),
    players,
    warnings,
  }
}

// Score/result for live surfaces (/live/watch, /live/scoreboard). While a game is IN_PROGRESS the live
// console's pushed score stays authoritative: it moves when a point is completed, in step with the
// score-flash animations. Otherwise (FINAL, or film-only games still SCHEDULED) the derived record wins.
export function displayScore(game: StatsGame, stats: GameStats): { score: Score; result: GameResult | null; derived: boolean } {
  if (game.status === "IN_PROGRESS") {
    return { score: { us: game.scoreVoid, them: game.scoreOpponent }, result: game.result ?? null, derived: false }
  }
  return { score: stats.score, result: stats.result, derived: true }
}
