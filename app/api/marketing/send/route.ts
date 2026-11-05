import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"

export const maxDuration = 300
import { verifyTOTP } from "@/lib/totp"
import { getNewsletter, type NewsletterItem } from "@/lib/aws/newsletters"
import { sendNewsletterToList, sendTestEmail } from "@/lib/aws/ses"
import {
  logSend, getSend, claimSendRun, markSendStarted, markBatchInFlight, recordBatchResult, finishSendRun,
  type SendRecord,
} from "@/lib/aws/sends"
import { logAudit } from "@/lib/aws/audit"
import { emailWorkerEnabled, invokeEmailWorker } from "@/lib/aws/email-worker"
import { canResume, emailBaseUrlProblem, isThrottleError, sendState, type SendStatus } from "@/lib/bulk-send"

// Amplify ends SSR requests at ~30 s and ignores maxDuration, so in production a run stops starting
// new batches after this budget and reports "partial"; the admin resumes it from the UI. Stopping
// cleanly (rather than being killed) keeps the record exact. Local dev has no limit.
const SEND_BUDGET_MS = (() => {
  const env = Number(process.env.MARKETING_SEND_BUDGET_MS)
  if (env > 0) return env
  return process.env.NODE_ENV === "production" ? 22_000 : undefined
})()

type SendOpts = {
  subject?: string
  replyTo?: string
  fromName?: string
  includeWebLink: boolean
  trackingEnabled: boolean
}

function isConditionFailed(err: unknown) {
  return (err as { name?: string } | null)?.name === "ConditionalCheckFailedException"
}

// Plain-language reasons; never raw AWS text.
function runErrorMessage(err: unknown): string {
  if (isThrottleError(err)) return "Amazon SES is rate-limiting requests right now. Wait a minute, then resume."
  if (isConditionFailed(err)) return "Another run took over this send."
  if (err instanceof Error && err.message.startsWith("Topic not found")) return "That list no longer exists."
  return "The send stopped because of a server error."
}

/** Streams one run of a list send (a first run or a resume) as SSE, persisting progress every batch. */
function streamListRun(args: {
  startedAt: number
  caller: { username: string }
  send: SendRecord
  runId: string
  newsletter: NewsletterItem
  opts: SendOpts
  resumed: boolean
}): Response {
  const { startedAt, caller, send, runId, newsletter, opts, resumed } = args
  const sendId = send.id
  const encoder = new TextEncoder()
  const prior = {
    sent: send.recipientCount ?? 0,
    failed: send.failedCount ?? 0,
    unknown: (send.unknownRecipients?.length ?? 0) + (send.inFlight?.length ?? 0),
  }

  const stream = new ReadableStream({
    async start(controller) {
      // The client may disconnect; the run carries on and keeps the record up to date.
      const emit = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {}
      }

      emit({ type: "sendId", sendId })

      let runSent = 0
      let runFailed = 0
      let total = 0
      let status: SendStatus = "partial"
      let errorMessage: string | null = null

      try {
        const result = await sendNewsletterToList(
          newsletter.id, newsletter, send.listName, opts, sendId,
          { onResult: (email, s) => emit({ type: "result", email, status: s }) },
          {
            exclude: resumed
              ? { sent: send.sentRecipients, failed: send.failedRecipients, unknown: [...(send.unknownRecipients ?? []), ...(send.inFlight ?? [])] }
              : undefined,
            deadline: SEND_BUDGET_MS ? startedAt + SEND_BUDGET_MS : undefined,
            onListed: async ({ toSend, trackedLinks }) => {
              total = prior.sent + prior.failed + prior.unknown + toSend
              await markSendStarted(sendId, runId, {
                totalRecipients: total,
                trackedLinks: !resumed && opts.trackingEnabled ? trackedLinks : undefined,
              })
              emit({ type: "start", total, alreadySent: prior.sent, alreadyFailed: prior.failed, unknown: prior.unknown })
            },
            beforeBatch: emails => markBatchInFlight(sendId, runId, emails),
            afterBatch: async r => {
              await recordBatchResult(sendId, runId, r.sent, r.failed)
              runSent += r.sent.length
              runFailed += r.failed.length
            },
          }
        )
        status = result.stoppedEarly ? "partial" : "complete"
      } catch (err) {
        const cancelled = isConditionFailed(err) && (await getSend(sendId).catch(() => null))?.cancelRequested
        if (cancelled) {
          status = "cancelled"
        } else {
          console.error(JSON.stringify({ event: "send_error", sendId, runId, error: err instanceof Error ? err.name : String(err) }))
          errorMessage = runErrorMessage(err)
        }
      }

      try {
        await finishSendRun(sendId, runId, status, errorMessage ?? undefined)
      } catch (err) {
        // Lost ownership or a DynamoDB error: the heartbeat goes stale and the UI shows "stopped".
        console.error(JSON.stringify({ event: "send_finish_write_failed", sendId, runId, error: err instanceof Error ? err.name : String(err) }))
      }

      // Awaited: a fire-and-forget write is lost when the serverless runtime freezes after the response.
      try {
        await logAudit({
          actorUsername: caller.username,
          action: "SEND",
          entityType: "SEND",
          entityId: sendId,
          entityLabel: resumed ? `[RESUME] ${newsletter.title}` : newsletter.title,
          newState: {
            newsletterTitle: newsletter.title,
            newsletterId: newsletter.id,
            listName: send.listName,
            recipientCount: runSent,
            failedCount: runFailed,
            totalSent: prior.sent + runSent,
            totalRecipients: total || undefined,
            status: errorMessage ? "error" : status,
            subject: opts.subject ?? newsletter.title,
            replyTo: opts.replyTo,
            fromName: opts.fromName,
            trackingEnabled: opts.trackingEnabled,
            sendMode: resumed ? "resume" : "list",
          },
          reversible: false,
        })
      } catch (err) {
        console.error(JSON.stringify({ event: "send_audit_failed", sendId, error: err instanceof Error ? err.name : String(err) }))
      }

      const counts = { sendId, sent: prior.sent + runSent, failed: prior.failed + runFailed, total }
      if (errorMessage) emit({ type: "error", message: errorMessage, ...counts })
      else if (status === "partial") emit({ type: "paused", ...counts })
      else if (status === "cancelled") emit({ type: "cancelled", ...counts })
      else emit({ type: "done", ...counts })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  })
}

/** Invokes the email worker for a job that is already queued under `runId`, audits, and returns the id. */
async function startWorkerRun(args: {
  caller: { username: string }
  send: SendRecord
  runId: string
  dryRun: boolean
  label: string
}): Promise<Response> {
  const { caller, send, runId, dryRun, label } = args
  try {
    await invokeEmailWorker({ sendId: send.id, runId, ...(dryRun ? { dryRun: true } : {}) })
  } catch (err) {
    console.error(JSON.stringify({ event: "email_worker_invoke_failed", sendId: send.id, error: err instanceof Error ? err.name : String(err) }))
    await finishSendRun(send.id, runId, "failed", "The email worker couldn't be started. Nothing was sent.").catch(() => {})
    return NextResponse.json({ error: "The email worker couldn't be started. Nothing was sent." }, { status: 502 })
  }

  await logAudit({
    actorUsername: caller.username,
    action: "SEND",
    entityType: "SEND",
    entityId: send.id,
    entityLabel: label,
    newState: {
      newsletterTitle: send.newsletterTitle,
      newsletterId: send.newsletterId,
      listName: send.listName,
      status: "queued",
      engine: "worker",
      dryRun,
      subject: send.sendOpts?.subject ?? send.newsletterTitle,
      replyTo: send.sendOpts?.replyTo,
      fromName: send.sendOpts?.fromName,
      trackingEnabled: send.trackingEnabled,
      sendMode: dryRun ? "dryrun" : label.startsWith("[RESUME]") ? "resume" : "list",
    },
    reversible: false,
  }).catch(err => console.error(JSON.stringify({ event: "send_audit_failed", sendId: send.id, error: err instanceof Error ? err.name : String(err) })))

  return NextResponse.json({ sendId: send.id, engine: "worker" }, { status: 202 })
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const body = await request.json()
  const { mode, newsletterId, subject, replyTo, fromName, includeWebLink, trackingEnabled, totpCode } = body

  if (!totpCode || !await verifyTOTP(totpCode)) {
    return NextResponse.json({ error: "Invalid or missing TOTP code" }, { status: 403 })
  }

  if (!newsletterId) return NextResponse.json({ error: "newsletterId is required" }, { status: 400 })

  const newsletter = await getNewsletter(newsletterId)
  if (!newsletter) return NextResponse.json({ error: "Newsletter not found" }, { status: 404 })

  // EMAIL-10: never send email whose links point at a dev server. Dry runs send nothing, so they're allowed.
  const baseUrlProblem = mode === "dryrun" ? null : emailBaseUrlProblem()
  if (baseUrlProblem) return NextResponse.json({ error: baseUrlProblem }, { status: 409 })

  const opts = {
    subject: typeof subject === "string" ? subject : undefined,
    replyTo: typeof replyTo === "string" ? replyTo : undefined,
    fromName: typeof fromName === "string" ? fromName : undefined,
    includeWebLink: includeWebLink === true,
    trackingEnabled: trackingEnabled === true,
  }

  if ((mode === "list" || mode === "dryrun") && emailWorkerEnabled()) {
    // Worker path: create the job, hand it to the email-worker Lambda, return at once.
    const { listName } = body
    if (!listName) return NextResponse.json({ error: "listName is required" }, { status: 400 })
    const dryRun = mode === "dryrun"
    const runId = randomUUID()
    const now = new Date().toISOString()
    const send = await logSend({
      newsletterId,
      newsletterTitle: newsletter.title,
      listName,
      sendMode: dryRun ? "dryrun" : "list",
      sentAt: now,
      sentBy: caller.username,
      recipientCount: 0,
      failedCount: 0,
      trackingEnabled: opts.trackingEnabled,
      status: "queued",
      engine: "worker",
      updatedAt: now,
      runId,
      ...(dryRun ? { dryRun: true } : {}),
      sendOpts: { subject: opts.subject, replyTo: opts.replyTo, fromName: opts.fromName, includeWebLink: opts.includeWebLink },
    })
    return startWorkerRun({ caller, send, runId, dryRun, label: dryRun ? `[DRY RUN] ${newsletter.title}` : newsletter.title })
  }

  if (mode === "dryrun") {
    return NextResponse.json({ error: "Dry runs need the email worker, which isn't set up yet." }, { status: 409 })
  }

  if (mode === "list") {
    const { listName } = body
    if (!listName) return NextResponse.json({ error: "listName is required" }, { status: 400 })

    const runId = randomUUID()
    const now = new Date().toISOString()
    // Pre-log the record immediately so it always exists, even if the function times out.
    // Progress is written to it every batch from here on.
    const send = await logSend({
      newsletterId,
      newsletterTitle: newsletter.title,
      listName,
      sendMode: "list",
      sentAt: now,
      sentBy: caller.username,
      recipientCount: 0,
      failedCount: 0,
      trackingEnabled: opts.trackingEnabled,
      status: "sending",
      engine: "inline",
      startedAt: now,
      updatedAt: now,
      runId,
      sentRecipients: [],
      failedRecipients: [],
      sendOpts: { subject: opts.subject, replyTo: opts.replyTo, fromName: opts.fromName, includeWebLink: opts.includeWebLink },
    })

    return streamListRun({ startedAt, caller, send, runId, newsletter, opts, resumed: false })
  }

  if (mode === "resume") {
    // Continue a stopped send: only recipients not yet sent, failed, or in an unconfirmed batch.
    const { sendId } = body
    if (typeof sendId !== "string" || !sendId) return NextResponse.json({ error: "sendId is required" }, { status: 400 })
    const send = await getSend(sendId)
    if (!send) return NextResponse.json({ error: "Send not found" }, { status: 404 })
    if (send.newsletterId !== newsletterId) {
      return NextResponse.json({ error: "Newsletter doesn't match this send" }, { status: 400 })
    }

    if (!canResume(send)) {
      const state = sendState(send)
      const error =
        state === "sending" ? "This send is still running. Try again in a minute."
        : state === "complete" ? "This send already finished."
        : "This send was made before progress tracking, so it can't be resumed without risking duplicates."
      return NextResponse.json({ error }, { status: 409 })
    }

    const viaWorker = send.engine === "worker"
    if (viaWorker && !emailWorkerEnabled()) {
      return NextResponse.json({ error: "This send uses the email worker, which isn't configured on this server." }, { status: 409 })
    }

    const runId = randomUUID()
    try {
      await claimSendRun(send, runId, viaWorker ? "queued" : "sending")
    } catch (err) {
      if (isConditionFailed(err)) {
        return NextResponse.json({ error: "This send is still running. Try again in a minute." }, { status: 409 })
      }
      throw err
    }

    if (viaWorker) {
      return startWorkerRun({ caller, send, runId, dryRun: false, label: `[RESUME] ${newsletter.title}` })
    }

    const resumeOpts: SendOpts = {
      subject: send.sendOpts?.subject,
      replyTo: send.sendOpts?.replyTo,
      fromName: send.sendOpts?.fromName,
      includeWebLink: send.sendOpts?.includeWebLink === true,
      trackingEnabled: send.trackingEnabled === true,
    }
    return streamListRun({ startedAt, caller, send, runId, newsletter, opts: resumeOpts, resumed: true })
  }

  if (mode === "test") {
    const { email } = body
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })

    const sendId = randomUUID()
    const testResult = await sendTestEmail(newsletter, email, opts, opts.trackingEnabled ? sendId : undefined)

    const record = await logSend({
      newsletterId,
      newsletterTitle: newsletter.title,
      listName: `test → ${email}`,
      sendMode: "test",
      sentAt: new Date().toISOString(),
      sentBy: caller.username,
      recipientCount: 1,
      trackingEnabled: opts.trackingEnabled,
      trackedLinks: opts.trackingEnabled ? testResult.trackedLinks : undefined,
    }, sendId)

    // Awaited (a fire-and-forget write is lost on serverless); a failed audit write doesn't fail the send.
    await logAudit({
      actorUsername: caller.username,
      action: "SEND",
      entityType: "SEND",
      entityId: record.id,
      entityLabel: `[TEST] ${newsletter.title}`,
      newState: {
        newsletterTitle: newsletter.title,
        newsletterId,
        toEmail: email,
        subject: opts.subject ? `[TEST] ${opts.subject}` : `[TEST] ${newsletter.title}`,
        replyTo: opts.replyTo,
        fromName: opts.fromName,
        trackingEnabled: opts.trackingEnabled,
        sendMode: "test",
      },
      reversible: false,
    }).catch(err => console.error(JSON.stringify({ event: "send_audit_failed", sendId, error: err instanceof Error ? err.name : String(err) })))

    return NextResponse.json({ success: true, sendId: record.id })
  }

  return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
}
