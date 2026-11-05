"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { apiFetch } from "@/lib/api-fetch"
import { canResume, isActiveState, sendCounts, sendState, type SendLike } from "@/lib/bulk-send"
import type { SendSummary } from "@/lib/aws/sends"

/** What the panel knows from its own request (the inline engine streams; the worker returns at once). */
export type LiveState = {
  phase: "starting" | "streaming" | "ended" | "interrupted" | "error"
  /** Plain-language error from the request, if any. */
  error?: string
}

type Props = {
  sendId: string | null
  title: string
  listName: string
  live: LiveState
  onClose: () => void
  onResume: (s: SendSummary) => void
  onCancel: (s: SendSummary) => Promise<void>
  onRecord?: (s: SendSummary) => void
  onViewStats?: (id: string) => void
}

const ACTIVE_POLL_MS = 2000
const HIDDEN_POLL_MS = 10000

function formatEta(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return null
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m < 60 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Progress for one send, read from the stored record (so it survives reloads and works for both engines). */
export function SendMonitor({ sendId, title, listName, live, onClose, onResume, onCancel, onRecord, onViewStats }: Props) {
  const [record, setRecord] = useState<SendSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const samples = useRef<{ t: number; done: number }[]>([])
  const onRecordRef = useRef(onRecord)
  onRecordRef.current = onRecord

  const liveActive = live.phase === "starting" || live.phase === "streaming"

  useEffect(() => {
    samples.current = []
    setRecord(null)
    setLoadError(null)
  }, [sendId])

  useEffect(() => {
    if (!sendId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      let active = liveActive
      try {
        const res = await apiFetch(`/api/marketing/sends/${encodeURIComponent(sendId!)}?summary=1`, { cache: "no-store" })
        if (stopped) return
        if (res.ok) {
          const s = (await res.json()) as SendSummary
          setRecord(s)
          setLoadError(null)
          onRecordRef.current?.(s)
          const done = (s.recipientCount ?? 0) + (s.failedCount ?? 0)
          const now = Date.now()
          samples.current = [...samples.current.filter(x => now - x.t < 30_000), { t: now, done }]
          active = active || isActiveState(sendState(s))
        } else if (res.status === 404) {
          setLoadError("This send no longer exists.")
          return
        } else {
          setLoadError("Couldn't refresh progress. Retrying…")
          active = true
        }
      } catch {
        if (stopped) return
        setLoadError("Can't reach the server. Retrying…")
        active = true
      }
      if (!stopped && active) {
        timer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : ACTIVE_POLL_MS)
      }
    }

    poll()
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        poll()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [sendId, liveActive, live.phase])

  const state = record ? sendState(record as SendLike) : null
  const counts = record ? sendCounts(record as SendLike) : null
  const isWorker = record?.engine === "worker"
  const isDryRun = record?.sendMode === "dryrun"
  const active = liveActive || (state !== null && isActiveState(state))
  const resumable = record ? canResume(record as SendLike) && !liveActive : false

  // Rate over the last ~30 s of samples, and the ETA from it.
  let rate: number | null = null
  const s = samples.current
  if (s.length >= 2 && s[s.length - 1].t > s[0].t) {
    rate = (s[s.length - 1].done - s[0].done) / ((s[s.length - 1].t - s[0].t) / 1000)
  }
  const eta = rate && rate > 0 && counts ? formatEta(counts.notSent / rate) : null

  const sentWord = isDryRun ? "would be sent" : "sent"
  let headline: string
  let tone: "default" | "warning" | "destructive" | "success" = "default"
  if (!sendId || !record) {
    headline = live.phase === "error" ? "The send didn't start." : "Starting…"
    if (live.phase === "error") tone = "destructive"
  } else if (live.phase === "interrupted" && state !== "complete" && state !== "cancelled") {
    headline = `The send stopped partway — ${counts!.sent} of ${counts!.total} sent. Resume to continue.`
    tone = "warning"
  } else if (state === "queued") {
    headline = "Queued — waiting for the email worker to start…"
  } else if (state === "sending" || liveActive) {
    headline = counts!.total > 0
      ? `${isDryRun ? "Checking" : "Sending"}… ${counts!.sent + counts!.failed} of ${counts!.total}`
      : "Loading the recipient list…"
  } else if (state === "stopped") {
    headline = record.engine === "inline" && record.status === "partial"
      ? `Paused after ${counts!.sent} of ${counts!.total} sent. The server can only send for about 20 seconds per request — resume to send to the remaining ${counts!.notSent}.`
      : `The send stopped partway — ${counts!.sent} of ${counts!.total} sent. Resume to continue.`
    tone = "warning"
  } else if (state === "failed") {
    headline = `The send failed — ${counts!.sent} of ${counts!.total} sent.`
    tone = "destructive"
  } else if (state === "cancelled") {
    headline = `Cancelled — ${counts!.sent} of ${counts!.total} ${sentWord}.`
    tone = "warning"
  } else {
    headline = isDryRun
      ? `Dry run finished — ${counts!.sent} of ${counts!.total} would be sent. No email went out.`
      : `Sent to ${counts!.sent} of ${counts!.total}.`
    tone = counts!.failed > 0 ? "warning" : "success"
  }

  const error = live.error ?? record?.lastError ?? null
  const pct = (n: number) => (counts && counts.total > 0 ? (n / counts.total) * 100 : 0)
  const toneClass = { default: "text-foreground", warning: "text-warning", destructive: "text-destructive", success: "text-success" }[tone]

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-monitor-title"
        className="bg-card border border-border rounded-t-xl sm:rounded-xl w-full sm:max-w-lg sm:mx-4 flex flex-col gap-4 p-5 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="send-monitor-title" className="font-semibold text-sm truncate">{record?.newsletterTitle ?? title}</p>
            <p className="text-fg-muted text-xs mt-0.5 truncate">
              {isDryRun ? "Dry run · " : ""}{record?.listName ?? listName}
            </p>
          </div>
          {active && <Spinner size="sm" />}
        </div>

        <p className={`text-sm ${toneClass}`} aria-live="polite">{headline}</p>
        {error && <p className="text-destructive text-xs bg-destructive/10 rounded-md px-2 py-1.5">{error}</p>}
        {loadError && <p className="text-fg-muted text-xs">{loadError}</p>}

        {counts && counts.total > 0 && (
          <div className="flex flex-col gap-2">
            <div
              className="w-full h-2 bg-surface-2 rounded-full overflow-hidden flex"
              role="progressbar"
              aria-label="Send progress"
              aria-valuemin={0}
              aria-valuemax={counts.total}
              aria-valuenow={counts.sent + counts.failed}
            >
              <div className="h-full bg-success transition-[width] duration-300" style={{ width: `${pct(counts.sent)}%` }} />
              <div className="h-full bg-destructive transition-[width] duration-300" style={{ width: `${pct(counts.failed)}%` }} />
              <div className="h-full bg-warning transition-[width] duration-300" style={{ width: `${pct(counts.unknown)}%` }} />
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-fg-muted">{isDryRun ? "Would send" : "Sent"}</dt>
                <dd className="font-mono tabular-nums text-foreground">{counts.sent}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Failed</dt>
                <dd className={`font-mono tabular-nums ${counts.failed > 0 ? "text-destructive" : "text-foreground"}`}>{counts.failed}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Remaining</dt>
                <dd className="font-mono tabular-nums text-foreground">{counts.notSent}</dd>
              </div>
            </dl>
            {active && (rate !== null || eta) && (
              <p className="text-xs text-fg-muted">
                {rate !== null && rate > 0 ? `${rate.toFixed(1)} emails/s` : "Measuring speed…"}
                {eta ? ` · about ${eta} left` : ""}
              </p>
            )}
            {counts.unknown > 0 && (
              <p className="text-xs text-fg-muted">
                {counts.unknown} {counts.unknown === 1 ? "address was" : "addresses were"} mid-send when a run stopped. They may
                have received it, so they won&apos;t be sent again automatically.
              </p>
            )}
          </div>
        )}

        {active && isWorker && (
          <p className="text-xs text-fg-muted">You can close this or reload the page — the send keeps running and this view comes back.</p>
        )}
        {active && !isWorker && sendId && (
          <p className="text-xs text-fg-muted">Keep this page open until it pauses or finishes.</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {record?.trackingEnabled && !isDryRun && onViewStats && sendId && (
            <Button variant="ghost" size="sm" onClick={() => onViewStats(sendId)}>View stats</Button>
          )}
          {record && active && state !== null && isActiveState(state) && (
            <Button
              variant="destructive"
              size="sm"
              loading={cancelling}
              onClick={async () => {
                setCancelling(true)
                try { await onCancel(record) } finally { setCancelling(false) }
              }}
            >
              Cancel send
            </Button>
          )}
          {record && resumable && (
            <Button size="sm" onClick={() => onResume(record)}>
              Resume · {counts?.notSent ?? 0} left
            </Button>
          )}
          <Button variant={resumable ? "ghost" : "secondary"} size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}
