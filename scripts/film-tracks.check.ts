// Edge cases for multi-angle alignment. Run: npx tsx scripts/film-tracks.check.ts
import assert from "node:assert/strict"
import {
  buildMainTimeline, buildAngleCoverage, mainToAngle, angleToMain, nextCoverage, locateMain,
  type FilmSyncPoint,
} from "../lib/film-tracks"

const S = 1000
const sync = (id: string, clipMs: number, mainClipId: string, mainClipMs: number): FilmSyncPoint =>
  ({ id, kind: "sync", clipMs, mainClipId, mainClipMs })
const desync = (id: string, clipMs: number): FilmSyncPoint => ({ id, kind: "desync", clipMs })
const clip = (id: string, syncPoints: FilmSyncPoint[], sortOrder = 0) =>
  ({ id, syncPoints, sortOrder, createdAt: "2026-01-01T00:00:00Z", trackId: "side" })

// Main film: two clips, 600s then 900s
const main = buildMainTimeline(["m1", "m2"], [600 * S, 900 * S])
const durations: Record<string, number> = { a1: 1200 * S, a2: 300 * S }
const dur = (id: string) => durations[id]

function check(name: string, fn: () => void) {
  fn()
  console.log(`✓ ${name}`)
}

check("main timeline locates clips", () => {
  assert.deepEqual(locateMain(main, 650 * S), { idx: 1, clipId: "m2", clipMs: 50 * S })
  assert.deepEqual(locateMain(main, 99999 * S)?.clipId, "m2")
})

check("single sync = constant offset over the whole clip", () => {
  // angle 10s in == main 40s in → offset +30s
  const cov = buildAngleCoverage([clip("a1", [sync("s", 10 * S, "m1", 40 * S)])], main, dur)
  assert.equal(cov.length, 1)
  assert.equal(cov[0].offsetMs, 30 * S)
  assert.equal(cov[0].clipStartMs, 0) // first sync covers the segment start
  assert.deepEqual(mainToAngle(100 * S, cov), { clipId: "a1", clipMs: 70 * S })
  assert.equal(angleToMain("a1", 70 * S, cov), 100 * S)
  // main time before the angle footage starts
  assert.equal(mainToAngle(10 * S, cov), null)
})

check("sync across main clip boundary", () => {
  // angle 0s == main clip m2 at 5s → main 605s
  const cov = buildAngleCoverage([clip("a1", [sync("s", 0, "m2", 5 * S)])], main, dur)
  assert.deepEqual(mainToAngle(700 * S, cov), { clipId: "a1", clipMs: 95 * S })
})

check("desync gap has no coverage; re-sync after it", () => {
  // Camera B: footage 0–300s synced (+30s), paused (desync at 300s), restarted footage synced at 320s → main 500s
  const cov = buildAngleCoverage([clip("a1", [
    sync("s1", 10 * S, "m1", 40 * S),
    desync("d", 300 * S),
    sync("s2", 320 * S, "m1", 500 * S),
  ])], main, dur)
  assert.equal(cov.length, 2)
  // before the pause
  assert.equal(angleToMain("a1", 299 * S, cov), 329 * S)
  // main 400s: B was paused (first stretch ended at main 330s, second starts at main 480s)
  assert.equal(mainToAngle(400 * S, cov), null)
  // second stretch starts at the desync (300s) with the new offset (+180s)
  assert.equal(cov[1].clipStartMs, 300 * S)
  assert.equal(cov[1].mainStartMs, 480 * S)
  assert.deepEqual(mainToAngle(490 * S, cov), { clipId: "a1", clipMs: 310 * S })
  assert.equal(nextCoverage(400 * S, cov)?.mainStartMs, 480 * S)
})

check("segment without a sync point has no coverage", () => {
  const cov = buildAngleCoverage([clip("a1", [sync("s", 10 * S, "m1", 40 * S), desync("d", 300 * S)])], main, dur)
  assert.equal(cov.length, 1)
  assert.equal(angleToMain("a1", 400 * S, cov), null)
})

check("multiple syncs in one segment re-anchor from their position", () => {
  const cov = buildAngleCoverage([clip("a1", [
    sync("s1", 10 * S, "m1", 40 * S),   // +30s
    sync("s2", 200 * S, "m1", 231 * S), // +31s from 200s on
  ])], main, dur)
  assert.equal(angleToMain("a1", 100 * S, cov), 130 * S)
  assert.equal(angleToMain("a1", 250 * S, cov), 281 * S)
})

check("multi-clip angle and sync on a removed main clip", () => {
  const cov = buildAngleCoverage([
    clip("a1", [sync("s1", 0, "m1", 0)]),
    clip("a2", [sync("s2", 0, "gone", 0)], 1), // anchor to a clip no longer on main → ignored
  ], main, dur)
  assert.equal(cov.length, 1)
  assert.equal(angleToMain("a2", 10 * S, cov), null)
})

check("overlapping angle clips prefer the current clip", () => {
  const cov = buildAngleCoverage([
    clip("a1", [sync("s1", 0, "m1", 0)]),
    clip("a2", [sync("s2", 0, "m1", 100 * S)], 1),
  ], main, dur)
  assert.equal(mainToAngle(150 * S, cov)?.clipId, "a1")
  assert.equal(mainToAngle(150 * S, cov, "a2")?.clipId, "a2")
})

check("unknown duration extends to the end", () => {
  const cov = buildAngleCoverage([clip("a3", [sync("s", 0, "m1", 0)])], main, () => undefined)
  assert.equal(cov[0].clipEndMs, Infinity)
  assert.equal(angleToMain("a3", 5000 * S, cov), 5000 * S)
})

console.log("All film-tracks checks passed")
