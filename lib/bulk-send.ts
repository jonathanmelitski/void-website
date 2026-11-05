// Pure helpers for bulk newsletter sends: paced/retried paging, batching with progress hooks, and
// resume bookkeeping. No AWS imports, so the batching and resume rules can be checked with mocks
// (scripts/bulk-send.check.ts) and the state helpers can be used in client components.

/** Per-recipient status shown in the Delivery modal. "unknown" = mid-send when a run stopped. */
export type DeliveryStatus = "sent" | "failed" | "unknown" | "pending" | "dryrun"

export type SendStatus ="queued" | "sending" | "partial" | "complete" | "failed" | "cancelled"

/** A "sending" record whose heartbeat is older than this is treated as stopped (the request was cut off). */
export const SEND_STALE_AFTER_MS = 60_000

type Sleep = (ms: number) => Promise<void>
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Links and the tracking pixel in sent email are built from NEXT_PUBLIC_BASE_URL (EMAIL-10). Returns a
 * plain-language reason to refuse sending when it isn't a public https origin (e.g. localhost in dev).
 */
export function emailBaseUrlProblem(value = process.env.NEXT_PUBLIC_BASE_URL ?? "https://voidultimate.com"): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "The site address used for email links isn't set correctly, so the send was blocked."
  }
  const host = url.hostname
  const local =
    host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1" || host === "[::1]" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (url.protocol !== "https:" || local) {
    return "Email links would point to this development server, so sending is blocked here. Send from the live site."
  }
  return null
}

export function normEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** SES (and most AWS APIs) report rate limiting as TooManyRequestsException / Throttling / HTTP 429. */
export function isThrottleError(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null
  if (!e) return false
  const name = e.name ?? e.Code ?? ""
  return (
    name === "TooManyRequestsException" ||
    name === "ThrottlingException" ||
    name === "Throttling" ||
    e.$metadata?.httpStatusCode === 429
  )
}

export type RetryOpts = { sleep?: Sleep; maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number }

/** Retries `fn` on throttling errors with exponential backoff (1s, 2s, 4s, 8s…). Other errors are thrown at once. */
export async function withThrottleRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const { sleep = realSleep, maxAttempts = 5, baseDelayMs = 1000, maxDelayMs = 8000 } = opts
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isThrottleError(err) || attempt >= maxAttempts) throw err
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs))
    }
  }
}

/** Fetches every page, waiting `pageIntervalMs` between pages (SES contact-list APIs allow ~1 req/s). */
export async function listAllPaced<T>(
  fetchPage: (nextToken: string | undefined) => Promise<{ items: T[]; nextToken?: string }>,
  opts: RetryOpts & { pageIntervalMs?: number } = {}
): Promise<T[]> {
  const { pageIntervalMs = 1100, ...retry } = opts
  const sleep = retry.sleep ?? realSleep
  const out: T[] = []
  let token: string | undefined
  let first = true
  do {
    if (!first) await sleep(pageIntervalMs)
    first = false
    const page = await withThrottleRetry(() => fetchPage(token), { ...retry, sleep })
    out.push(...page.items)
    token = page.nextToken
  } while (token)
  return out
}

/** What a resumed run should send: current list minus everyone already sent, failed, or in an unconfirmed batch. */
export function selectResumeRecipients(
  current: string[],
  done: { sent?: string[]; failed?: string[]; unknown?: string[] }
): { toSend: string[]; skipped: number } {
  const seen = new Set<string>()
  for (const e of [...(done.sent ?? []), ...(done.failed ?? []), ...(done.unknown ?? [])]) seen.add(normEmail(e))
  const toSend: string[] = []
  let skipped = 0
  for (const e of current) {
    const k = normEmail(e)
    if (seen.has(k)) {
      skipped++
      continue
    }
    seen.add(k) // also drops duplicates within the list
    toSend.push(e)
  }
  return { toSend, skipped }
}

export type BatchResult = { sent: string[]; failed: string[] }

export type BatchedSendParams = {
  recipients: string[]
  sendOne: (email: string) => Promise<void>
  batchSize?: number
  batchDelayMs?: number
  sleep?: Sleep
  now?: () => number
  /** Epoch ms. No new batch starts at or after this time; the run returns with `remaining`. */
  deadline?: number
  /** Awaited before a batch is sent (record the batch as in flight). Throwing stops the run before sending. */
  beforeBatch?: (emails: string[]) => Promise<void>
  /** Awaited after each batch (persist progress). Throwing stops the run. */
  afterBatch?: (result: BatchResult) => Promise<void>
  onResult?: (email: string, status: "sent" | "failed") => void
}

export type BatchedSendResult = BatchResult & { remaining: string[]; stoppedEarly: boolean }

export async function runBatchedSend(p: BatchedSendParams): Promise<BatchedSendResult> {
  const { recipients, sendOne, batchSize = 10, batchDelayMs = 1000, sleep = realSleep, now = Date.now } = p
  const sent: string[] = []
  const failed: string[] = []
  for (let i = 0; i < recipients.length; i += batchSize) {
    if (i > 0) await sleep(batchDelayMs)
    if (p.deadline !== undefined && now() >= p.deadline) {
      return { sent, failed, remaining: recipients.slice(i), stoppedEarly: true }
    }
    const batch = recipients.slice(i, i + batchSize)
    await p.beforeBatch?.(batch)
    const result: BatchResult = { sent: [], failed: [] }
    await Promise.all(
      batch.map(async (email) => {
        let ok = false
        try {
          await sendOne(email)
          ok = true
        } catch {}
        ;(ok ? result.sent : result.failed).push(email)
        // A listener error (e.g. the client disconnected) must never turn a sent email into a failure.
        try {
          p.onResult?.(email, ok ? "sent" : "failed")
        } catch {}
      })
    )
    sent.push(...result.sent)
    failed.push(...result.failed)
    await p.afterBatch?.(result)
  }
  return { sent, failed, remaining: [], stoppedEarly: false }
}

// ── Reading a send record (client-safe) ──────────────────────────────────────────

export type SendLike = {
  sendMode?: "list" | "test" | "dryrun"
  engine?: "inline" | "worker"
  status?: SendStatus
  updatedAt?: string
  recipientCount: number
  failedCount?: number
  unknownCount?: number
  totalRecipients?: number
  sentRecipients?: string[]
  unknownRecipients?: string[]
  inFlight?: string[]
  tracksRecipients?: boolean
  sendOpts?: unknown
}

/** A queued worker job that hasn't started after this long is treated as stuck (stopped). */
export const QUEUED_STALE_AFTER_MS = 3 * 60_000

/** "legacy" = sent before progress tracking existed: only the final counts (if any) were stored. */
export type SendState = "queued" | "sending" | "stopped" | "complete" | "cancelled" | "failed" | "legacy"

export function sendState(s: SendLike, now = Date.now()): SendState {
  if (s.sendMode === "test") return "complete"
  if (!s.status) return "legacy"
  if (s.status === "complete" || s.status === "cancelled" || s.status === "failed") return s.status
  if (s.status === "partial") return "stopped"
  const last = s.updatedAt ? new Date(s.updatedAt).getTime() : 0
  if (s.status === "queued") return now - last > QUEUED_STALE_AFTER_MS ? "stopped" : "queued"
  return now - last > SEND_STALE_AFTER_MS ? "stopped" : "sending"
}

export function isActiveState(state: SendState): boolean {
  return state === "queued" || state === "sending"
}

/** Counts for display. `notSent` = not attempted yet (what a resume would send). */
export function sendCounts(s: SendLike) {
  const sent = s.recipientCount ?? 0
  const failed = s.failedCount ?? 0
  const unknown = s.unknownCount ?? (s.unknownRecipients?.length ?? 0) + (s.inFlight?.length ?? 0)
  const total = s.totalRecipients ?? sent + failed
  const notSent = Math.max(0, total - sent - failed - unknown)
  return { sent, failed, unknown, total, notSent }
}

/** True when a send can be continued safely (it recorded who already got it). */
export function canResume(s: SendLike, now = Date.now()): boolean {
  if (s.sendMode !== "list" || !s.sendOpts) return false
  const state = sendState(s, now)
  if (s.engine === "worker") return state === "stopped" || state === "failed" || state === "cancelled"
  return (Array.isArray(s.sentRecipients) || s.tracksRecipients === true) && (state === "stopped" || state === "cancelled")
}

