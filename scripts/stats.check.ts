// Derived game stats checks. Run: npx tsx scripts/stats.check.ts
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { deriveGameStats, displayScore, type StatsEvent, type StatsGame, type StatsPoint, type StatsPlayer } from "../lib/stats/derive"

function check(name: string, fn: () => void) {
  fn()
  console.log(`✓ ${name}`)
}

type FixtureGame = { game: StatsGame & { opponent: string }; points: StatsPoint[]; pointEvents: StatsEvent[] }
const fixture: { players: StatsPlayer[]; games: FixtureGame[] } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/stats-games.json"), "utf8"),
)
const byOpp = (opp: string) => {
  const g = fixture.games.find(x => x.game.opponent === opp)
  assert.ok(g, `fixture game ${opp}`)
  return g
}
const derive = (g: FixtureGame) => deriveGameStats(g.game, g.points, g.pointEvents, fixture.players)
const sources = (s: ReturnType<typeof derive>) =>
  s.points.reduce<Record<string, number>>((m, p) => ((m[p.source] = (m[p.source] ?? 0) + 1), m), {})

// Dry-run output (stats-scripts/derive-dryrun.mjs against the same dump)
const DRY_RUN: Record<string, { us: number; them: number; sources: Record<string, number> }> = {
  "CMU": { us: 8, them: 10, sources: { "inferred-next-score": 10, "goal-event": 8, unscored: 1 } },
  "WCU Alums": { us: 8, them: 11, sources: { "point-outcome": 11, "goal-event": 8 } },
  "WCU": { us: 0, them: 0, sources: {} },
  "Bucks": { us: 6, them: 13, sources: { "point-outcome": 13, "goal-event": 6 } },
  "American": { us: 15, them: 6, sources: { "goal-event": 15, "point-outcome": 6 } },
  "PSU": { us: 8, them: 15, sources: { "point-outcome": 15, "goal-event": 8 } },
  "Temple": { us: 12, them: 7, sources: { "goal-event": 12, "point-outcome": 7 } },
  "Delaware": { us: 1, them: 1, sources: { "goal-event": 1, "point-outcome": 1, unscored: 1 } },
  "Drexel": { us: 0, them: 0, sources: { unscored: 2 } },
}
const CONSISTENT = ["PSU", "American", "Temple", "WCU Alums", "Bucks", "Delaware", "WCU"]

check("every fixture game matches the dry run score and sources", () => {
  assert.equal(fixture.games.length, Object.keys(DRY_RUN).length)
  for (const g of fixture.games) {
    const want = DRY_RUN[g.game.opponent]
    const s = derive(g)
    assert.deepEqual(s.score, { us: want.us, them: want.them }, g.game.opponent)
    assert.deepEqual(sources(s), want.sources, g.game.opponent)
    assert.equal(s.points.filter(p => p.conflict).length, 0, `${g.game.opponent} conflicts`)
  }
})

check("consistent games: derived score, result and team stats equal the stored record", () => {
  for (const opp of CONSISTENT) {
    const g = byOpp(opp)
    const s = derive(g)
    assert.deepEqual(s.score, s.storedScore, opp)
    assert.equal(s.result, g.game.result ?? null, `${opp} result`)
    assert.ok(!s.warnings.some(w => w.code === "stored-score-differs"), `${opp} no score warning`)
    // Independent count from stored outcomes of COMPLETE points
    const done = g.points.filter(p => p.status === "COMPLETE")
    const n = (line: "O" | "D", outcome: "HOLD" | "BREAK") => done.filter(p => p.lineType === line && p.outcome === outcome).length
    assert.deepEqual(s.team.us, { oPoints: n("O", "HOLD") + n("O", "BREAK"), holds: n("O", "HOLD"), dPoints: n("D", "HOLD") + n("D", "BREAK"), breaks: n("D", "BREAK") }, opp)
    assert.deepEqual(s.team.them, { oPoints: s.team.us.dPoints, holds: n("D", "HOLD"), dPoints: s.team.us.oPoints, breaks: n("O", "BREAK") }, opp)
    // Per-point derived outcome equals the stored one on completed points, and scoreBefore equals the typed record
    for (const p of s.points) {
      const stored = g.points.find(x => x.id === p.id)!
      if (stored.status === "COMPLETE") {
        assert.equal(p.outcome, stored.outcome, `${opp} P${p.pointNumber} outcome`)
        assert.deepEqual(p.scoreBefore, { us: stored.voidScoreBefore, them: stored.opponentScoreBefore }, `${opp} P${p.pointNumber} scoreBefore`)
      }
    }
  }
})

check("PSU holds count only our holds (not both teams')", () => {
  const s = derive(byOpp("PSU"))
  assert.equal(s.team.us.holds + s.team.us.breaks, 8)
  assert.equal(s.team.them.holds + s.team.them.breaks, 15)
  const oldHoldsCard = byOpp("PSU").points.filter(p => p.status === "COMPLETE" && p.outcome === "HOLD").length
  assert.equal(oldHoldsCard, s.team.us.holds + s.team.them.holds) // the old card summed both teams
})

check("player stats count every event like today's table (incl. incomplete points)", () => {
  for (const g of fixture.games) {
    const s = derive(g)
    const count = (t: string) => g.pointEvents.filter(e => e.eventType === t && e.playerId).length
    const sum = (k: "goals" | "assists" | "blocks" | "turnovers" | "pulls") => s.players.reduce((a, p) => a + p[k], 0)
    assert.equal(sum("goals"), count("GOAL"), g.game.opponent)
    assert.equal(sum("assists"), count("ASSIST"), g.game.opponent)
    assert.equal(sum("blocks"), count("BLOCK"), g.game.opponent)
    assert.equal(sum("turnovers"), count("TURNOVER"), g.game.opponent)
    assert.equal(sum("pulls"), count("PULL"), g.game.opponent)
    const played = g.points.reduce((a, p) => a + new Set(p.playerIds ?? []).size, 0)
    assert.equal(s.players.reduce((a, p) => a + p.pointsPlayed, 0), played, g.game.opponent)
  }
  const cmu = derive(byOpp("CMU"))
  assert.equal(cmu.players.reduce((a, p) => a + p.goals, 0), 8)
  assert.equal(cmu.players.reduce((a, p) => a + p.assists, 0), 8)
})

check("CMU: 8–10 with P16 missing, P20 no result, stored 0–0 flagged, result LOSS", () => {
  const s = derive(byOpp("CMU"))
  assert.deepEqual(s.score, { us: 8, them: 10 })
  assert.equal(s.result, "LOSS")
  const msgs = s.warnings.map(w => w.message)
  assert.ok(msgs.includes("P16 missing"), msgs.join("; "))
  assert.ok(msgs.includes("P20 has no result"), msgs.join("; "))
  assert.ok(s.warnings.some(w => w.code === "stored-score-differs"))
  const p17 = s.points.find(p => p.pointNumber === 17)!
  assert.deepEqual(p17.scoreBefore, { us: 5, them: 10 }) // recomputed: the missing P16 is not counted
  assert.equal(p17.outcome, "BREAK")
})

check("Drexel: two empty in-progress points on a scheduled game", () => {
  const s = derive(byOpp("Drexel"))
  assert.deepEqual(s.score, { us: 0, them: 0 })
  assert.equal(s.result, null)
  assert.deepEqual(s.team.us, { oPoints: 0, holds: 0, dPoints: 0, breaks: 0 })
  assert.equal(s.oEfficiency, null)
  assert.equal(s.dConversion, null)
  assert.equal(s.warnings.filter(w => w.code === "no-result").length, 2)
})

// ── Synthetic edge cases ─────────────────────────────────────────────
const game = (over: Partial<StatsGame> = {}): StatsGame => ({ id: "g", status: "FINAL", scoreVoid: 0, scoreOpponent: 0, ...over })
const pt = (n: number, lineType: "O" | "D", o: Partial<StatsPoint> = {}): StatsPoint => ({
  id: `p${n}`, pointNumber: n, lineType, outcome: "IN_PROGRESS", status: "IN_PROGRESS", voidScoreBefore: 0, opponentScoreBefore: 0, playerIds: [], ...o,
})
const ev = (id: string, pointId: string, eventType: StatsEvent["eventType"], playerId = "a"): StatsEvent => ({ id, pointId, eventType, playerId })

check("no points", () => {
  const s = deriveGameStats(game({ status: "SCHEDULED" }), [], [])
  assert.deepEqual(s.score, { us: 0, them: 0 })
  assert.equal(s.result, null)
  assert.deepEqual(s.points, [])
  assert.deepEqual(s.warnings, [])
  assert.equal(deriveGameStats(game(), [], []).result, "TIE") // FINAL with nothing scored is a tie
})

check("all points in progress, live game: only finished-but-unscored points warn", () => {
  const pts = [pt(1, "O"), pt(2, "D", { voidScoreBefore: 0, opponentScoreBefore: 1 }), pt(3, "O")]
  const s = deriveGameStats(game({ status: "IN_PROGRESS" }), pts, [])
  assert.deepEqual(s.points.map(p => p.source), ["inferred-next-score", "unscored", "unscored"])
  assert.deepEqual(s.score, { us: 0, them: 1 })
  assert.equal(s.result, null)
  assert.deepEqual(s.warnings.filter(w => w.code === "no-result").map(w => w.pointNumber), [2]) // P3 is the live point
})

check("goal event wins over a conflicting stored outcome, with a warning", () => {
  // O-line point stored as BREAK (they scored) but film has our GOAL
  const pts = [pt(1, "O", { status: "COMPLETE", outcome: "BREAK" })]
  const s = deriveGameStats(game({ scoreOpponent: 1 }), pts, [ev("e1", "p1", "GOAL"), ev("e2", "p1", "ASSIST", "b")])
  assert.equal(s.points[0].scorer, "US")
  assert.equal(s.points[0].outcome, "HOLD")
  assert.equal(s.points[0].conflict, true)
  assert.deepEqual(s.score, { us: 1, them: 0 })
  assert.ok(s.warnings.some(w => w.code === "goal-conflict" && w.pointNumber === 1))
  assert.ok(s.warnings.some(w => w.code === "stored-score-differs"))
})

check("deleted goal falls back to the stored outcome; stored outcome alone is not a conflict", () => {
  const pts = [pt(1, "D", { status: "COMPLETE", outcome: "BREAK" }), pt(2, "D", { status: "COMPLETE", outcome: "HOLD", voidScoreBefore: 1 })]
  const s = deriveGameStats(game({ scoreVoid: 1, scoreOpponent: 1 }), pts, []) // no GOAL events at all
  assert.deepEqual(s.points.map(p => [p.scorer, p.source]), [["US", "point-outcome"], ["THEM", "point-outcome"]])
  assert.deepEqual(s.team.us, { oPoints: 0, holds: 0, dPoints: 2, breaks: 1 })
  assert.deepEqual(s.team.them, { oPoints: 2, holds: 1, dPoints: 0, breaks: 0 })
  assert.equal(s.dConversion, 50)
  assert.equal(s.warnings.length, 0)
})

check("inference needs the very next point number and an exact +1 for them only", () => {
  const gap = deriveGameStats(game(), [pt(1, "D"), pt(3, "D", { opponentScoreBefore: 1 })], [])
  assert.equal(gap.points[0].source, "unscored")
  assert.ok(gap.warnings.some(w => w.message === "P2 missing"))
  const both = deriveGameStats(game(), [pt(1, "D"), pt(2, "D", { opponentScoreBefore: 1, voidScoreBefore: 1 })], [])
  assert.equal(both.points[0].source, "unscored")
})

check("orphan events are skipped with a warning; multiple goals warn", () => {
  const s = deriveGameStats(game({ scoreVoid: 1 }), [pt(1, "O", { playerIds: ["a", "b"] })],
    [ev("e1", "p1", "GOAL"), ev("e2", "p1", "GOAL", "b"), ev("e3", "gone", "GOAL")], [{ id: "a", first_name: "A", last_name: "A" }])
  assert.deepEqual(s.score, { us: 1, them: 0 })
  assert.equal(s.players.find(p => p.playerId === "a")!.goals, 1)
  assert.equal(s.players.find(p => p.playerId === "b")!.player, null)
  assert.equal(s.players.find(p => p.playerId === "a")!.pointsPlayed, 1)
  assert.ok(s.warnings.some(w => w.code === "orphan-events"))
  assert.ok(s.warnings.some(w => w.code === "multiple-goals"))
})

check("live surfaces keep the pushed score while IN_PROGRESS, derived otherwise", () => {
  const pts = [pt(1, "O"), pt(2, "D")]
  const events = [ev("e1", "p1", "GOAL")] // goal logged, point not yet completed in the console
  const live = game({ status: "IN_PROGRESS", scoreVoid: 0 })
  assert.deepEqual(displayScore(live, deriveGameStats(live, pts, events)), { score: { us: 0, them: 0 }, result: null, derived: false })
  const cmu = byOpp("CMU")
  assert.deepEqual(displayScore(cmu.game, derive(cmu)).score, { us: 8, them: 10 })
})

console.log("all stats checks passed")
