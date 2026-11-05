// Email-worker job loop, free of AWS imports so it can be checked with mocks
// (scripts/bulk-send.check.ts). handler.ts wires the real SES / DynamoDB / Lambda clients in.
//
// Safety rules this file guarantees:
// - A recipient is only sent after a conditional PENDING→SENDING transition succeeds, so a retry,
//   a self-re-invoke or a resume can never send to the same address twice.
// - Rows left in SENDING by a crash are "unknown" and are never re-sent automatically.
// - A dry run has no `sendEmail` dependency at all; the loop refuses to start if one is supplied.

import { isThrottleError, normEmail } from "../lib/bulk-send"

export type RecipientStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "DRYRUN"

export type WorkerEvent = {
  sendId: string
  runId: string
  dryRun?: boolean
  /** Dry run without a send record (setup check): job state lives in memory. sendId must start with "dryrun-". */
  ephemeral?: { listName: string }
}

export type Job = {
  id: string
  runId?: string
  status?: string
  listName: string
  newsletterTitle: string
  sentBy: string
  dryRun?: boolean
  cancelRequested?: boolean
  recipientsLoaded?: boolean
  startedAt?: string
  recipientCount: number
  failedCount?: number
}

export type JobPatch = { set?: Record<string, unknown>; add?: Record<string, number> }

export interface WorkerDeps {
  now(): number
  sleep(ms: number): Promise<void>
  /** Time left in this Lambda invocation. */
  remainingMs(): number
  getJob(id: string): Promise<Job | null>
  /** Conditional on job.runId === runId; throws (ConditionalCheckFailedException) otherwise. */
  updateJob(id: string, runId: string, patch: JobPatch): Promise<void>
  listContacts(listName: string): Promise<string[]>
  /** Conditional put (attribute_not_exists). Returns false if the row already existed. */
  putRecipientIfAbsent(sendId: string, email: string): Promise<boolean>
  queryRecipients(sendId: string, status: RecipientStatus, limit: number): Promise<string[]>
  countRecipients(sendId: string, status: RecipientStatus): Promise<number>
  /** Conditional update status from→to. Returns false if the row wasn't in `from`. */
  transition(sendId: string, email: string, from: RecipientStatus, to: RecipientStatus, extra?: Record<string, unknown>): Promise<boolean>
  /** Absent in dry-run mode. */
  sendEmail?: (email: string) => Promise<{ messageId?: string }>
  maxSendRate(): Promise<number>
  reinvoke(event: WorkerEvent): Promise<void>
  audit(entry: { sendId: string; label: string; state: Record<string, unknown> }): Promise<void>
  log(event: string, data?: Record<string, unknown>): void
}

export type WorkerOutcome = "complete" | "handoff" | "cancelled" | "superseded" | "failed" | "noop"

/** Hand off to a fresh invocation when less than this is left (a batch + writes take a few seconds). */
export const HANDOFF_MARGIN_MS = 60_000
export const MAX_RATE = 10

const iso = (ms: number) => new Date(ms).toISOString()

async function sendWithBackoff(deps: WorkerDeps, email: string): Promise<{ messageId?: string }> {
  const send = deps.sendEmail!
  for (let attempt = 1; ; attempt++) {
    try {
      return await send(email)
    } catch (err) {
      if (!isThrottleError(err) || attempt >= 5) throw err
      await deps.sleep(Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250))
    }
  }
}

function errorText(err: unknown): string {
  if (isThrottleError(err)) return "Rate limited by Amazon SES"
  const name = (err as { name?: string } | null)?.name
  return name ? `SES rejected the message (${name})` : "SES rejected the message"
}

export async function runWorker(event: WorkerEvent, deps: WorkerDeps): Promise<{ outcome: WorkerOutcome; sent: number; failed: number }> {
  const { sendId, runId } = event
  const dryRun = event.dryRun === true
  let runSent = 0
  let runFailed = 0
  const result = (outcome: WorkerOutcome) => ({ outcome, sent: runSent, failed: runFailed })

  const job = await deps.getJob(sendId)
  if (!job) return result("noop")
  if (job.runId !== runId) return result("superseded")
  if (job.status === "complete" || job.status === "cancelled") return result("noop")

  // Dry-run guard: the event and the job must agree, and a dry run must have no way to send.
  if (dryRun !== (job.dryRun === true)) throw new Error("dryRun flag doesn't match the job")
  if (dryRun && deps.sendEmail) throw new Error("dry run must not be given an email sender")
  if (!dryRun && !deps.sendEmail) throw new Error("no email sender configured")

  const finish = async (status: "complete" | "cancelled" | "failed", extra: Record<string, unknown> = {}) => {
    const unknownCount = await deps.countRecipients(sendId, "SENDING")
    await deps.updateJob(sendId, runId, {
      set: { status, updatedAt: iso(deps.now()), finishedAt: iso(deps.now()), unknownCount, ...extra },
    })
    const fresh = await deps.getJob(sendId)
    await deps.audit({
      sendId,
      label: `[${status.toUpperCase()}${dryRun ? " · DRY RUN" : ""}] ${job.newsletterTitle}`,
      state: {
        listName: job.listName, status, dryRun,
        recipientCount: fresh?.recipientCount ?? 0, failedCount: fresh?.failedCount ?? 0, unknownCount,
        ...extra,
      },
    })
  }

  try {
    if (job.cancelRequested) {
      await finish("cancelled")
      return result("cancelled")
    }

    await deps.updateJob(sendId, runId, {
      set: { status: "sending", updatedAt: iso(deps.now()), ...(job.startedAt ? {} : { startedAt: iso(deps.now()) }) },
    })

    if (!job.recipientsLoaded) {
      const seen = new Set<string>()
      const emails: string[] = []
      for (const e of await deps.listContacts(job.listName)) {
        const k = normEmail(e)
        if (!k || seen.has(k)) continue
        seen.add(k)
        emails.push(k)
      }
      // Idempotent: a row that already exists (any status) is left alone.
      for (let i = 0; i < emails.length; i += 25) {
        await Promise.all(emails.slice(i, i + 25).map(e => deps.putRecipientIfAbsent(sendId, e)))
      }
      await deps.updateJob(sendId, runId, {
        set: { totalRecipients: emails.length, recipientsLoaded: true, updatedAt: iso(deps.now()) },
      })
      deps.log("recipients_loaded", { sendId, total: emails.length })
    }

    const rate = Math.max(1, Math.min(MAX_RATE, Math.floor(await deps.maxSendRate())))

    for (;;) {
      if (deps.remainingMs() < HANDOFF_MARGIN_MS) {
        await deps.updateJob(sendId, runId, { set: { updatedAt: iso(deps.now()) } })
        await deps.reinvoke({ sendId, runId, dryRun: dryRun || undefined, ephemeral: event.ephemeral })
        deps.log("handoff", { sendId, runSent, runFailed })
        return result("handoff")
      }

      const current = await deps.getJob(sendId)
      if (!current || current.runId !== runId) return result("superseded")
      if (current.cancelRequested) {
        await finish("cancelled")
        return result("cancelled")
      }

      const batch = await deps.queryRecipients(sendId, "PENDING", rate)
      if (batch.length === 0) {
        await finish("complete")
        return result("complete")
      }

      const started = deps.now()
      let sent = 0
      let failed = 0
      await Promise.all(batch.map(async email => {
        if (!(await deps.transition(sendId, email, "PENDING", "SENDING", { claimedAt: iso(deps.now()), runId }))) return
        if (dryRun) {
          await deps.transition(sendId, email, "SENDING", "DRYRUN")
          sent++
          return
        }
        try {
          const { messageId } = await sendWithBackoff(deps, email)
          sent++
          await deps.transition(sendId, email, "SENDING", "SENT", { messageId, sentAt: iso(deps.now()) })
        } catch (err) {
          failed++
          await deps.transition(sendId, email, "SENDING", "FAILED", { error: errorText(err) })
        }
      }))

      runSent += sent
      runFailed += failed
      await deps.updateJob(sendId, runId, {
        set: { updatedAt: iso(deps.now()) },
        add: { recipientCount: sent, failedCount: failed },
      })

      const wait = 1000 - (deps.now() - started)
      if (wait > 0) await deps.sleep(wait)
    }
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (name === "ConditionalCheckFailedException") return result("superseded")
    deps.log("worker_error", { sendId, error: name ?? String(err) })
    const lastError = isThrottleError(err)
      ? "Amazon SES is rate-limiting requests. Resume in a few minutes."
      : "The email worker stopped because of a server error. Resume to continue."
    try {
      await finish("failed", { lastError })
    } catch {}
    return result("failed")
  }
}
