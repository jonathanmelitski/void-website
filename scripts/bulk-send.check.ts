// Safety checks for bulk sends with mocked SES/DynamoDB (nothing real is called).
// Run: npx tsx scripts/bulk-send.check.ts
import assert from "node:assert/strict"
import { runBatchedSend, selectResumeRecipients, withThrottleRetry } from "../lib/bulk-send"
import { runWorker, SIM_TOPIC, type Job, type RecipientStatus, type WorkerDeps } from "../email-worker/core"

const list = Array.from({ length: 627 }, (_, i) => `person${i}@example.com`)
const noSleep = async () => {}

async function check(name: string, fn: () => Promise<void>) {
  await fn()
  console.log(`✓ ${name}`)
}

async function main() {

await check("inline: cut-off run + resume sends every address exactly once; in-flight batch is never re-sent", async () => {
  const sends = new Map<string, number>()
  const sendOne = async (e: string) => { sends.set(e, (sends.get(e) ?? 0) + 1) }
  let clock = 0
  const record = { sent: [] as string[], failed: [] as string[], inFlight: [] as string[] }

  // Run 1 stops at its time budget after 20 batches.
  const r1 = await runBatchedSend({
    recipients: selectResumeRecipients(list, {}).toSend, sendOne, sleep: noSleep,
    now: () => clock++, deadline: 20,
    beforeBatch: async b => { record.inFlight = b },
    afterBatch: async r => { record.sent.push(...r.sent); record.failed.push(...r.failed); record.inFlight = [] },
  })
  assert.equal(r1.stoppedEarly, true)
  assert.equal(record.sent.length, 200)

  // Run 2 is killed mid-batch: the batch went out but its result never got recorded.
  await assert.rejects(runBatchedSend({
    recipients: selectResumeRecipients(list, { sent: record.sent, failed: record.failed }).toSend, sendOne, sleep: noSleep,
    beforeBatch: async b => { record.inFlight = b },
    afterBatch: async () => { throw new Error("killed") },
  }))
  const unknown = record.inFlight
  assert.equal(unknown.length, 10)

  // Run 3 (resume) skips sent + unknown, list order or case changes don't matter.
  const shuffled = [...list].reverse().map(e => e.toUpperCase())
  const { toSend } = selectResumeRecipients(shuffled, { sent: record.sent, failed: record.failed, unknown })
  await runBatchedSend({ recipients: toSend, sendOne: e => sendOne(e.toLowerCase()), sleep: noSleep })
  assert.equal(sends.size, 627)
  assert.ok([...sends.values()].every(n => n === 1), "someone got the email twice")
})

await check("inline: a listener error never turns a sent email into a failure", async () => {
  const r = await runBatchedSend({ recipients: ["a@x.com"], sendOne: async () => {}, sleep: noSleep, onResult: () => { throw new Error("client gone") } })
  assert.deepEqual(r.sent, ["a@x.com"])
})

await check("throttling: ListContacts retries with backoff, then gives up", async () => {
  const waits: number[] = []
  let calls = 0
  const out = await withThrottleRetry(async () => {
    if (++calls < 3) throw Object.assign(new Error("Rate exceeded"), { name: "TooManyRequestsException" })
    return "ok"
  }, { sleep: async ms => { waits.push(ms) } })
  assert.equal(out, "ok")
  assert.deepEqual(waits, [1000, 2000])
  await assert.rejects(withThrottleRetry(async () => { throw new Error("boom") }, { sleep: noSleep }), /boom/)
})

// ── Worker with an in-memory "DynamoDB" ─────────────────────────────────────────

function makeWorld(opts: { dryRun?: boolean; listName?: string } = {}) {
  const job: Job & Record<string, unknown> = {
    id: "s1", runId: "run1", status: "queued", listName: opts.listName ?? "void-alumni", newsletterTitle: "N", sentBy: "admin",
    recipientCount: 0, failedCount: 0, dryRun: opts.dryRun,
  }
  const rows = new Map<string, RecipientStatus>()
  const sesCalls: string[] = []
  let remaining = 15 * 60_000
  let clock = 0
  const deps: WorkerDeps = {
    now: () => clock,
    sleep: async ms => { clock += ms },
    remainingMs: () => remaining,
    getJob: async () => ({ ...job }),
    updateJob: async (_id, runId, patch) => {
      if (job.runId !== runId) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" })
      Object.assign(job, patch.set ?? {})
      for (const [k, v] of Object.entries(patch.add ?? {})) job[k] = ((job[k] as number) ?? 0) + v
    },
    listContacts: async () => [...list, list[0].toUpperCase()], // includes a duplicate
    putRecipientIfAbsent: async (_s, e) => (rows.has(e) ? false : (rows.set(e, "PENDING"), true)),
    queryRecipients: async (_s, st, limit) => [...rows].filter(([, v]) => v === st).slice(0, limit).map(([k]) => k),
    countRecipients: async (_s, st) => [...rows.values()].filter(v => v === st).length,
    transition: async (_s, e, from, to) => (rows.get(e) === from ? (rows.set(e, to), true) : false),
    sendEmail: opts.dryRun ? undefined : async e => { sesCalls.push(e); return { messageId: "m" } },
    maxSendRate: async () => 14,
    reinvoke: async () => {},
    audit: async () => {},
    log: () => {},
  }
  return { job, rows, sesCalls, deps, setRemaining: (ms: number) => { remaining = ms } }
}

await check("worker: hands off before the time limit, resumes with the same run, sends each address once", async () => {
  const w = makeWorld()
  let batches = 0
  const reinvoked: unknown[] = []
  w.deps.reinvoke = async e => { reinvoked.push(e) }
  const realQuery = w.deps.queryRecipients
  w.deps.queryRecipients = async (...a) => { if (++batches > 5) w.setRemaining(30_000); return realQuery(...a) }
  const first = await runWorker({ sendId: "s1", runId: "run1" }, w.deps)
  assert.equal(first.outcome, "handoff")
  assert.deepEqual(reinvoked, [{ sendId: "s1", runId: "run1", dryRun: undefined, ephemeral: undefined, maxRunMs: undefined }])
  assert.equal(w.job.totalRecipients, 627, "duplicates are dropped")
  assert.equal(w.sesCalls.length, 60) // 6 batches of 10 before the handoff check trips

  w.setRemaining(15 * 60_000)
  w.deps.queryRecipients = realQuery
  const second = await runWorker({ sendId: "s1", runId: "run1" }, w.deps)
  assert.equal(second.outcome, "complete")
  assert.equal(w.sesCalls.length, 627)
  assert.equal(new Set(w.sesCalls).size, 627)
  assert.equal(w.job.recipientCount, 627)
  assert.equal(w.job.status, "complete")
})

await check("worker: a resume after a crash never re-sends rows left mid-send; a superseded run stops", async () => {
  const w = makeWorld()
  w.setRemaining(30_000) // load recipients, then hand off immediately
  await runWorker({ sendId: "s1", runId: "run1" }, w.deps)
  // Simulate a crash mid-batch: 3 rows claimed (SENDING), email maybe sent.
  const stuck = [...w.rows.keys()].slice(0, 3)
  stuck.forEach(e => w.rows.set(e, "SENDING"))
  // Admin resumes: new run id.
  w.job.runId = "run2"
  w.job.status = "queued"
  w.setRemaining(15 * 60_000)
  assert.equal((await runWorker({ sendId: "s1", runId: "run1" }, w.deps)).outcome, "superseded")
  assert.equal((await runWorker({ sendId: "s1", runId: "run2" }, w.deps)).outcome, "complete")
  assert.ok(stuck.every(e => !w.sesCalls.includes(e)), "unknown rows must not be re-sent")
  assert.equal(w.sesCalls.length, 624)
  assert.equal(w.job.unknownCount, 3)
})

await check("worker: cancel stops before the next batch", async () => {
  const w = makeWorld()
  let batches = 0
  const realGet = w.deps.getJob
  w.deps.getJob = async id => { if (++batches === 4) w.job.cancelRequested = true; return realGet(id) }
  const out = await runWorker({ sendId: "s1", runId: "run1" }, w.deps)
  assert.equal(out.outcome, "cancelled")
  assert.equal(w.job.status, "cancelled")
  assert.equal(w.sesCalls.length, 20) // 2 batches of 10 before the flag was seen
  assert.equal(w.job.recipientCount, 20)
})

await check("worker dry run: never calls SES and refuses a sender", async () => {
  const w = makeWorld({ dryRun: true })
  const out = await runWorker({ sendId: "s1", runId: "run1", dryRun: true }, w.deps)
  assert.equal(out.outcome, "complete")
  assert.equal(w.sesCalls.length, 0)
  assert.equal([...w.rows.values()].filter(v => v === "DRYRUN").length, 627)

  const bad = makeWorld({ dryRun: true })
  bad.deps.sendEmail = async () => ({})
  await assert.rejects(runWorker({ sendId: "s1", runId: "run1", dryRun: true }, bad.deps), /must not be given an email sender/)
  const mismatch = makeWorld()
  await assert.rejects(runWorker({ sendId: "s1", runId: "run1", dryRun: true }, mismatch.deps), /doesn't match/)
})

await check("worker: test hand-off knob (maxRunMs) works on the simulator list and carries over", async () => {
  const w = makeWorld({ listName: SIM_TOPIC })
  const reinvoked: Record<string, unknown>[] = []
  w.deps.reinvoke = async e => { reinvoked.push(e) }
  // Each batch waits out its second on the fake clock, so 5 s ≈ 5 batches.
  const first = await runWorker({ sendId: "s1", runId: "run1", maxRunMs: 5_000 }, w.deps)
  assert.equal(first.outcome, "handoff")
  assert.equal(reinvoked[0].maxRunMs, 5_000, "the next invocation keeps the knob")
  assert.ok(w.sesCalls.length > 0 && w.sesCalls.length < 627)

  let runs = 1
  for (let out = first; out.outcome === "handoff"; runs++) out = await runWorker(reinvoked.at(-1) as never, w.deps)
  assert.ok(runs > 3, "several hand-offs")
  assert.equal(w.job.status, "complete")
  assert.equal(new Set(w.sesCalls).size, 627)
  assert.equal(w.sesCalls.length, 627, "no address sent twice across hand-offs")
})

await check("worker: maxRunMs is ignored on a real list", async () => {
  const w = makeWorld()
  const logs: string[] = []
  w.deps.log = e => { logs.push(e) }
  const out = await runWorker({ sendId: "s1", runId: "run1", maxRunMs: 1 }, w.deps)
  assert.equal(out.outcome, "complete")
  assert.ok(logs.includes("max_run_ignored"))
})

await check("worker: final counts come from the rows when a taken-over run's counter write was lost", async () => {
  const w = makeWorld()
  const realUpdate = w.deps.updateJob
  let dropped = false
  // Lose one batch's counter ADD (as when a run is superseded right after sending a batch).
  w.deps.updateJob = async (id, runId, patch) => {
    if (!dropped && patch.add?.recipientCount) { dropped = true; return }
    return realUpdate(id, runId, patch)
  }
  await runWorker({ sendId: "s1", runId: "run1" }, w.deps)
  assert.equal(w.job.status, "complete")
  assert.equal(w.job.recipientCount, 627)
})

console.log("all bulk-send checks passed")
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
