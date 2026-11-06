// End-to-end test of the deployed void-email-worker with REAL sends to the SES mailbox simulator.
//
//   npx tsx scripts/email-worker.e2e.ts                       # all scenarios
//   npx tsx scripts/email-worker.e2e.ts --only=handoff,cancel # some of them
//   npx tsx scripts/email-worker.e2e.ts --keep                # leave records to inspect in the UI
//
// Scenarios (each a real send of the ses-simulator list, ~1000 simulator emails):
//   dryrun   send record with dryRun: every row DRYRUN, no message ids, counters match
//   handoff  maxRunMs forces several self-re-invokes; every address SENT exactly once
//   cancel   cancel mid-send, then resume with a new runId; nobody gets it twice
//   supersede a second run takes over mid-send (as Resume does); the first one stops
//
// It invokes the Lambda the same way POST /api/marketing/send does (async Event invoke after writing
// a queued send record), so it tests the deployed code, role and environment. Records it creates:
// one unpublished "[E2E]" newsletter, the send records and their recipient rows, all deleted at the
// end unless --keep. The worker's audit rows stay (labelled "[E2E] …"). Simulator mail reaches no
// mailbox and doesn't affect reputation; it counts against the 50k/day quota.
// Uses the AWS CLI's credentials (us-east-2).
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { SIM_TOPIC } from "../email-worker/core"
import { deleteRecipientRows, recipientRows } from "./email-worker.smoke"

const REGION = "us-east-2"
const FUNCTION = process.env.EMAIL_WORKER_FUNCTION_NAME ?? "void-email-worker"
const SENDS = process.env.DYNAMO_SENDS_TABLE ?? "VoidEmailSends"
const NEWSLETTERS = process.env.DYNAMO_NEWSLETTERS_TABLE ?? "VoidNewsletters"

const lambda = new LambdaClient({ region: REGION })
const logs = new CloudWatchLogsClient({ region: REGION })
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Send = {
  id: string; runId: string; status?: string; recipientCount: number; failedCount?: number; totalRecipients?: number
  unknownCount?: number; lastError?: string; cancelRequested?: boolean; recipientsLoaded?: boolean
}

const created = { newsletters: [] as string[], sends: [] as string[] }

async function createNewsletter(): Promise<{ id: string; title: string }> {
  const id = `e2e-${randomUUID()}`
  const title = "[E2E] Email worker test"
  const now = new Date().toISOString()
  await ddb.send(new PutCommand({
    TableName: NEWSLETTERS,
    Item: {
      id, slug: id, title, date: now, published: false, createdAt: now,
      body: "<p>Automated email-worker test sent only to the Amazon SES mailbox simulator.</p>",
      entries: [{ id: randomUUID(), title: "Test entry", body: "<p>Nothing to see here.</p>", authorUsername: "email-worker-e2e", createdAt: now }],
    },
    ConditionExpression: "attribute_not_exists(id)",
  }))
  created.newsletters.push(id)
  return { id, title }
}

async function createSend(newsletter: { id: string; title: string }, opts: { dryRun?: boolean } = {}): Promise<Send> {
  const now = new Date().toISOString()
  const item = {
    id: randomUUID(), runId: randomUUID(),
    newsletterId: newsletter.id, newsletterTitle: newsletter.title, listName: SIM_TOPIC,
    sendMode: opts.dryRun ? "dryrun" : "list", sentAt: now, sentBy: "email-worker-e2e",
    recipientCount: 0, failedCount: 0, trackingEnabled: false, status: "queued", engine: "worker", updatedAt: now,
    ...(opts.dryRun ? { dryRun: true } : {}),
    sendOpts: { subject: newsletter.title, includeWebLink: false },
  }
  await ddb.send(new PutCommand({ TableName: SENDS, Item: item }))
  created.sends.push(item.id)
  return item
}

async function invoke(payload: { sendId: string; runId: string; dryRun?: boolean; maxRunMs?: number }) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: FUNCTION, InvocationType: "Event", Payload: Buffer.from(JSON.stringify(payload)),
  }))
  assert.equal(res.StatusCode, 202, "async invoke accepted")
}

const getSend = async (id: string) =>
  (await ddb.send(new GetCommand({ TableName: SENDS, Key: { id }, ConsistentRead: true }))).Item as Send

/** Polls the record until `done` says so (or it reaches a terminal status). */
async function waitFor(id: string, done: (s: Send) => boolean, label: string, timeoutMs = 15 * 60_000): Promise<Send> {
  const start = Date.now()
  let lastLine = ""
  for (;;) {
    const s = await getSend(id)
    const line = `  ${label}: ${s.status} ${s.recipientCount}/${s.totalRecipients ?? "?"} sent, ${s.failedCount ?? 0} failed`
    if (line !== lastLine) { console.log(line); lastLine = line }
    if (done(s)) return s
    if (s.status === "failed") throw new Error(`send failed: ${s.lastError}`)
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await sleep(2000)
  }
}
const terminal = (s: Send) => ["complete", "cancelled", "failed"].includes(s.status ?? "")

/** Worker log events for a send (CloudWatch lags a few seconds behind). */
async function logEvents(sendId: string, sinceMs: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let nextToken: string | undefined
  do {
    const res = await logs.send(new FilterLogEventsCommand({
      logGroupName: `/aws/lambda/${FUNCTION}`, startTime: sinceMs, filterPattern: `"${sendId}"`, nextToken,
    }))
    for (const e of res.events ?? []) {
      const i = e.message?.indexOf("{") ?? -1
      if (i < 0) continue
      try { out.push(JSON.parse(e.message!.slice(i))) } catch {}
    }
    nextToken = res.nextToken
  } while (nextToken)
  return out
}

/** Every address exactly once, all SENT with a message id, and the record's counters agree. */
async function assertSentExactlyOnce(s: Send) {
  const rows = await recipientRows(s.id)
  const emails = rows.map(r => r.email)
  assert.equal(new Set(emails).size, emails.length, "one row per address")
  const bad = rows.filter(r => r.status !== "SENT" || !r.messageId)
  assert.equal(bad.length, 0, `rows not SENT with a message id: ${bad.slice(0, 5).map(r => `${r.email}=${r.status}`).join(", ")}`)
  assert.ok(rows.every(r => r.email.endsWith("@simulator.amazonses.com")), "only simulator addresses")
  assert.equal(new Set(rows.map(r => r.messageId)).size, rows.length, "a distinct SES message per address")
  assert.equal(s.status, "complete")
  assert.equal(s.totalRecipients, rows.length)
  assert.equal(s.recipientCount, rows.length, "recipientCount matches SENT rows (nothing counted twice)")
  assert.equal(s.failedCount ?? 0, 0)
  assert.equal(s.unknownCount ?? 0, 0)
  return rows.length
}

const scenarios: Record<string, (nl: { id: string; title: string }) => Promise<string>> = {
  async dryrun(nl) {
    const s = await createSend(nl, { dryRun: true })
    await invoke({ sendId: s.id, runId: s.runId, dryRun: true })
    const done = await waitFor(s.id, terminal, "dry run")
    const rows = await recipientRows(s.id)
    assert.equal(done.status, "complete")
    assert.ok(rows.length > 0 && rows.every(r => r.status === "DRYRUN" && !r.messageId), "all DRYRUN, no message ids")
    assert.equal(done.recipientCount, rows.length)
    return `${rows.length} DRYRUN rows, no SES calls`
  },

  async handoff(nl) {
    const since = Date.now() - 5000
    const s = await createSend(nl)
    await invoke({ sendId: s.id, runId: s.runId, maxRunMs: 20_000 })
    const done = await waitFor(s.id, terminal, "handoff")
    const n = await assertSentExactlyOnce(done)
    let handoffs = 0
    for (let i = 0; i < 20 && handoffs === 0; i++) {
      await sleep(3000)
      handoffs = (await logEvents(s.id, since)).filter(e => e.event === "handoff").length
    }
    assert.ok(handoffs >= 2, `expected several hand-offs, saw ${handoffs} (is the maxRunMs build deployed?)`)
    return `${n} sent exactly once across ${handoffs + 1} invocations`
  },

  async cancel(nl) {
    const s = await createSend(nl)
    await invoke({ sendId: s.id, runId: s.runId })
    await waitFor(s.id, x => x.recipientCount >= 100 || terminal(x), "before cancel")
    await ddb.send(new UpdateCommand({ TableName: SENDS, Key: { id: s.id }, UpdateExpression: "SET cancelRequested = :t", ExpressionAttributeValues: { ":t": true } }))
    const cancelled = await waitFor(s.id, terminal, "cancelling")
    assert.equal(cancelled.status, "cancelled")
    const midRows = await recipientRows(s.id)
    const sentBefore = midRows.filter(r => r.status === "SENT").length
    assert.ok(midRows.some(r => r.status === "PENDING"), "cancel left work undone")
    assert.equal(cancelled.recipientCount, sentBefore)

    // Resume, the way claimSendRun does: new runId, clear the cancel flag, back to queued.
    const runId = randomUUID()
    await ddb.send(new UpdateCommand({
      TableName: SENDS, Key: { id: s.id },
      UpdateExpression: "SET runId = :r, #s = :q, updatedAt = :now REMOVE cancelRequested, finishedAt, lastError",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":r": runId, ":q": "queued", ":now": new Date().toISOString() },
    }))
    await invoke({ sendId: s.id, runId })
    const done = await waitFor(s.id, terminal, "resumed")
    const n = await assertSentExactlyOnce(done)
    return `cancelled at ${sentBefore}, resumed to ${n}, nobody sent twice`
  },

  async supersede(nl) {
    const since = Date.now() - 5000
    const s = await createSend(nl)
    await invoke({ sendId: s.id, runId: s.runId })
    await waitFor(s.id, x => x.recipientCount >= 100 || terminal(x), "run 1")
    // A second run takes the job over while run 1 is still going.
    const run2 = randomUUID()
    await ddb.send(new UpdateCommand({
      TableName: SENDS, Key: { id: s.id }, UpdateExpression: "SET runId = :r, #s = :q",
      ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":r": run2, ":q": "queued" },
    }))
    await invoke({ sendId: s.id, runId: run2 })
    const done = await waitFor(s.id, terminal, "run 2")
    const n = await assertSentExactlyOnce(done)
    // Run 1 must have stopped without finishing the job (its result is "superseded", logged as done).
    let outcomes: unknown[] = []
    for (let i = 0; i < 20 && !outcomes.includes("superseded"); i++) {
      await sleep(3000)
      outcomes = (await logEvents(s.id, since)).filter(e => e.event === "done").map(e => e.outcome)
    }
    assert.ok(outcomes.includes("superseded"), `run 1 should report superseded; saw ${JSON.stringify(outcomes)}`)
    return `${n} sent exactly once; run 1 stood down`
  },
}

async function cleanup() {
  for (const id of created.sends) {
    const n = await deleteRecipientRows(id)
    await ddb.send(new DeleteCommand({ TableName: SENDS, Key: { id } }))
    console.log(`  removed send ${id} (${n} rows)`)
  }
  for (const id of created.newsletters) {
    await ddb.send(new DeleteCommand({ TableName: NEWSLETTERS, Key: { id } }))
    console.log(`  removed newsletter ${id}`)
  }
}

async function main() {
  const only = process.argv.find(a => a.startsWith("--only="))?.slice(7).split(",")
  const keep = process.argv.includes("--keep")
  const names = only ?? Object.keys(scenarios)
  for (const n of names) if (!scenarios[n]) throw new Error(`unknown scenario ${n}; have ${Object.keys(scenarios).join(", ")}`)

  const results: { name: string; ok: boolean; detail: string }[] = []
  try {
    const nl = await createNewsletter()
    for (const name of names) {
      console.log(`\n▶ ${name}`)
      const t = Date.now()
      try {
        const detail = await scenarios[name](nl)
        results.push({ name, ok: true, detail: `${detail} (${Math.round((Date.now() - t) / 1000)} s)` })
      } catch (err) {
        results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) })
      }
    }
  } finally {
    if (keep) console.log(`\n--keep: left sends ${created.sends.join(", ")} and newsletter ${created.newsletters.join(", ")}`)
    else { console.log("\ncleanup"); await cleanup() }
  }

  console.log("\nresults")
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail}`)
  if (results.some(r => !r.ok)) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
