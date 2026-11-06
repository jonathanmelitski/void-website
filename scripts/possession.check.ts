// Possession and break-chance derivation (lib/stats/possession.ts). Run: npx tsx scripts/possession.check.ts
import assert from "node:assert/strict"
import { breakStats, pointPossessions, type PossessionEvent } from "../lib/stats/possession"
import { deriveGameStats } from "../lib/stats/derive"
import type { PointEventType } from "../lib/point-event-meta"

let n = 0
const ev = (pointId: string, ...types: PointEventType[]): PossessionEvent[] =>
  types.map((eventType, i) => ({ id: `e${++n}`, pointId, eventType, sortOrder: i + 1 }))
function check(name: string, fn: () => void) { fn(); console.log(`✓ ${name}`) }

check("O-line hold with no turns: one VOID possession", () => {
  const p = pointPossessions({ id: "a", lineType: "O" }, ev("a", "PULL", "PULL_FINISHED", "ASSIST", "GOAL"))
  assert.deepEqual(p.possessions.map(x => x.team), ["VOID"])
  assert.equal(p.current, "VOID")
})

check("D-line: block, our turnover, their unforced turnover, goal: possession alternates", () => {
  const p = pointPossessions({ id: "b", lineType: "D" }, ev("b", "PULL", "BLOCK", "TURNOVER", "OPP_TURNOVER", "GOAL"))
  assert.deepEqual(p.possessions.map(x => x.team), ["OPP", "VOID", "OPP", "VOID"])
  assert.equal(p.inconsistent, false)
})

check("timeouts, subs and tap-ins don't change possession; a live point reports who has it", () => {
  const p = pointPossessions({ id: "c", lineType: "O" }, ev("c", "TIMEOUT", "TAP_IN", "TURNOVER", "SUBSTITUTION"))
  assert.equal(p.current, "OPP")
})

check("events are read in sortOrder, not array order", () => {
  const events = ev("d", "TURNOVER", "BLOCK").reverse()
  assert.equal(pointPossessions({ id: "d", lineType: "O" }, events).current, "VOID")
})

check("a block while we already have it is flagged, not counted", () => {
  const p = pointPossessions({ id: "e", lineType: "O" }, ev("e", "BLOCK"))
  assert.equal(p.inconsistent, true)
  assert.equal(p.possessions.length, 1)
})

check("break stats: chances per possession on D points, conversions per scored D point, Callahan counts once", () => {
  const points = [
    { id: "d1", lineType: "D" as const }, // block, turn, block, goal: 2 chances, converted
    { id: "d2", lineType: "D" as const }, // block, turn, they score: 1 chance
    { id: "d3", lineType: "D" as const }, // Callahan: no possession event, still 1 chance converted
    { id: "o1", lineType: "O" as const }, // turn, they score: their 1 chance, their break
    { id: "o2", lineType: "O" as const }, // clean hold
  ]
  const events = [
    ...ev("d1", "BLOCK", "TURNOVER", "BLOCK", "GOAL"),
    ...ev("d2", "BLOCK", "TURNOVER"),
    ...ev("d3", "GOAL"),
    ...ev("o1", "TURNOVER"),
    ...ev("o2", "GOAL"),
  ]
  const scorer = { d1: "US", d2: "THEM", d3: "US", o1: "THEM", o2: "US" } as const
  const s = breakStats(points, events, id => scorer[id as keyof typeof scorer])
  assert.equal(s.breakChances, 4)
  assert.equal(s.breaks, 2)
  assert.equal(s.dPointsWithChance, 3)
  assert.equal(s.breakConversion, 50)
  assert.equal(s.oppBreakChances, 1)
  assert.equal(s.oppBreaks, 1)
  assert.equal(s.oppBreakConversion, 100)
})

check("deriveGameStats carries possession, break chances and turnover types (no sortOrder: input order)", () => {
  const game = { id: "g", status: "FINAL" as const, scoreVoid: 1, scoreOpponent: 1 }
  const points = [
    { id: "p1", pointNumber: 1, lineType: "D" as const, outcome: "BREAK" as const, status: "COMPLETE" as const, voidScoreBefore: 0, opponentScoreBefore: 0 },
    { id: "p2", pointNumber: 2, lineType: "D" as const, outcome: "HOLD" as const, status: "COMPLETE" as const, voidScoreBefore: 1, opponentScoreBefore: 0 },
  ]
  const events = [
    { id: "a", pointId: "p1", eventType: "OPP_TURNOVER" as const, playerId: "", turnoverType: "DROP" as const },
    { id: "b", pointId: "p1", eventType: "TURNOVER" as const, playerId: "x", turnoverType: "THROWAWAY" as const },
    { id: "c", pointId: "p1", eventType: "BLOCK" as const, playerId: "y" },
    { id: "d", pointId: "p1", eventType: "GOAL" as const, playerId: "z" },
    { id: "e", pointId: "p2", eventType: "BLOCK" as const, playerId: "y" },
    { id: "f", pointId: "p2", eventType: "TURNOVER" as const, playerId: "x" },
  ]
  const s = deriveGameStats(game, points, events)
  assert.deepEqual(s.points[0].possessions, { us: 2, them: 2 })
  assert.equal(s.points[0].turns, 3)
  assert.equal(s.possession.breakChances, 3)
  assert.equal(s.possession.breaks, 1)
  assert.equal(s.turnovers.us.total, 2)
  assert.deepEqual(s.turnovers.us.byType, { THROWAWAY: 1, UNSPECIFIED: 1 })
  assert.deepEqual(s.turnovers.them.byType, { DROP: 1, BLOCKED: 2 })
  assert.deepEqual(s.players.find(p => p.playerId === "x")?.turnoverTypes, { THROWAWAY: 1, UNSPECIFIED: 1 })
})

check("player +/- and O/D efficiency (final line, scored points only)", () => {
  const game = { id: "g", status: "IN_PROGRESS" as const, scoreVoid: 1, scoreOpponent: 1 }
  const points = [
    { id: "o1", pointNumber: 1, lineType: "O" as const, outcome: "HOLD" as const, status: "COMPLETE" as const, voidScoreBefore: 0, opponentScoreBefore: 0, playerIds: ["x", "y"] },
    { id: "d1", pointNumber: 2, lineType: "D" as const, outcome: "HOLD" as const, status: "COMPLETE" as const, voidScoreBefore: 1, opponentScoreBefore: 0, playerIds: ["x"] },
    { id: "live", pointNumber: 3, lineType: "O" as const, outcome: "IN_PROGRESS" as const, status: "IN_PROGRESS" as const, voidScoreBefore: 1, opponentScoreBefore: 1, playerIds: ["x"] },
  ]
  const events = [
    { id: "1", pointId: "o1", eventType: "GOAL" as const, playerId: "x" },
    { id: "2", pointId: "o1", eventType: "ASSIST" as const, playerId: "y" },
    { id: "3", pointId: "d1", eventType: "BLOCK" as const, playerId: "x" },
    { id: "4", pointId: "d1", eventType: "TURNOVER" as const, playerId: "x" },
    { id: "5", pointId: "live", eventType: "TURNOVER" as const, playerId: "x" },
  ]
  const x = deriveGameStats(game, points, events).players.find(p => p.playerId === "x")!
  assert.equal(x.pointsPlayed, 3)
  assert.equal(x.plusMinus, 1 + 1 - 2) // G + B − T
  assert.deepEqual([x.oPoints, x.oHolds, x.oEfficiency], [1, 1, 100]) // live point not counted
  assert.deepEqual([x.dPoints, x.dBreaks, x.dEfficiency], [1, 0, 0])
})

check("hucks and field zones", () => {
  const game = { id: "g", status: "FINAL" as const, scoreVoid: 1, scoreOpponent: 0 }
  const points = [{ id: "p", pointNumber: 1, lineType: "O" as const, outcome: "HOLD" as const, status: "COMPLETE" as const, voidScoreBefore: 0, opponentScoreBefore: 0 }]
  const events = [
    { id: "1", pointId: "p", eventType: "TURNOVER" as const, playerId: "t", huck: true, zone: "OWN" as const },
    { id: "2", pointId: "p", eventType: "BLOCK" as const, playerId: "b", zone: "MID" as const },
    { id: "3", pointId: "p", eventType: "ASSIST" as const, playerId: "a", huck: true, zone: "MID" as const },
    { id: "4", pointId: "p", eventType: "GOAL" as const, playerId: "g", huck: true, zone: "MID" as const },
  ]
  const s = deriveGameStats(game, points, events)
  assert.deepEqual(s.hucks, { goals: 1, turnovers: 1, attempts: 2, pct: 50 })
  assert.deepEqual(s.zones, { goalsFrom: { MID: 1 }, turnovers: { OWN: 1 }, gains: { MID: 1 }, tagged: 3 })
  const by = (id: string) => s.players.find(p => p.playerId === id)!
  assert.equal(by("a").huckAssists, 1)
  assert.equal(by("g").huckGoals, 1)
  assert.equal(by("t").huckTurnovers, 1)
})

console.log("all possession checks passed")
