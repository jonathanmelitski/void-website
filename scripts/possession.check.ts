// Possession and break-chance derivation (lib/stats/possession.ts). Run: npx tsx scripts/possession.check.ts
import assert from "node:assert/strict"
import { breakStats, pointPossessions, type PossessionEvent } from "../lib/stats/possession"
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

console.log("all possession checks passed")
