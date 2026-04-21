"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { StepProgress } from "@/components/ui/step-progress"
import type { StepDef } from "@/lib/step-types"
import type { LiveServerInfo } from "@/app/api/live-server/route"

const STATUS_DOT: Record<string, string> = {
  online:   "bg-green-400",
  starting: "bg-yellow-400 animate-pulse",
  stopping: "bg-yellow-400 animate-pulse",
  unhealthy:"bg-red-400",
  offline:  "bg-white/20",
}

const STATUS_LABEL: Record<string, string> = {
  online:   "Online",
  starting: "Starting…",
  stopping: "Stopping…",
  unhealthy:"Unhealthy",
  offline:  "Offline",
}

export function LiveServerPanel() {
  const [info, setInfo] = useState<LiveServerInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [steps, setSteps] = useState<StepDef[]>([])
  const [confirmingDestroy, setConfirmingDestroy] = useState(false)
  const [error, setError] = useState("")
  const [logs, setLogs] = useState<string | null>(null)
  const [fetchingLogs, setFetchingLogs] = useState(false)
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchStatus() {
    try {
      const res = await fetch("/api/live-server")
      if (res.ok) {
        const data = await res.json()
        setInfo(data)
        return data
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus().then(data => {
      if (data?.job?.steps?.length) setSteps(data.job.steps)
      if (data?.job && !data.job.completedAt && !data.job.errorMessage) {
        setActing(true)
        startPolling()
      }
    })
    statusIntervalRef.current = setInterval(fetchStatus, 5000)
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current)
      if (pollRef.current) clearInterval(pollRef.current)
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  function startPolling() {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/live-server")
        if (!res.ok) return
        const data = await res.json()
        setInfo(data)
        if (data.job?.steps) setSteps(data.job.steps)
        if (data.job?.completedAt || data.job?.errorMessage) {
          stopPolling()
          setActing(false)
          if (data.job?.errorMessage) setError(data.job.errorMessage)
        }
      } catch {}
    }, 2000)
  }

  function runAction(action: "start" | "stop" | "destroy-all") {
    setActing(true)
    setError("")
    setSteps([])
    startPolling()
    // Fire-and-forget — Lambda keeps running past HTTP timeout; client polls for progress
    fetch("/api/live-server", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {}) // 504 is expected for long operations
  }

  async function handleFetchLogs() {
    setFetchingLogs(true)
    setLogs(null)
    try {
      const res = await fetch("/api/live-server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logs" }),
      })
      const d = await res.json()
      setLogs(d.output ?? d.error ?? "No output")
    } catch {
      setLogs("Network error")
    } finally {
      setFetchingLogs(false)
    }
  }

  function handleDestroyClick() {
    if (!confirmingDestroy) {
      setConfirmingDestroy(true)
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
      confirmTimeoutRef.current = setTimeout(() => setConfirmingDestroy(false), 5000)
    } else {
      clearTimeout(confirmTimeoutRef.current!)
      setConfirmingDestroy(false)
      runAction("destroy-all")
    }
  }

  const status = info?.status ?? "offline"
  const canStart = !acting && status === "offline"
  const canStop = !acting && (status === "online" || status === "unhealthy" || status === "starting")
  const canDestroy = !acting

  return (
    <section className="flex flex-col gap-6 max-w-lg">
      <h2 className="text-lg font-bold">Live Server</h2>

      {/* Status card */}
      <div className="border border-white/10 rounded-lg p-5 flex flex-col gap-4">
        {loading ? (
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
              <span className="font-medium">{STATUS_LABEL[status] ?? status}</span>
              {info?.publicIp && (
                <span className="text-white/40 text-sm font-mono ml-auto">{info.publicIp}</span>
              )}
            </div>

            {info?.health && (
              <div className="flex gap-6 text-sm text-white/60">
                <span>
                  <span className="text-white font-medium">{info.health.games}</span>{" "}
                  active {info.health.games === 1 ? "game" : "games"}
                </span>
                <span>
                  <span className="text-white font-medium">{info.health.subscribers}</span>{" "}
                  {info.health.subscribers === 1 ? "subscriber" : "subscribers"}
                </span>
              </div>
            )}

            {info?.instanceId && (
              <p className="text-xs text-white/30 font-mono">{info.instanceId}</p>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" disabled={!canStart} onClick={() => runAction("start")}>
          {acting && status === "offline" ? "Starting…" : "Start Server"}
        </Button>

        <Button size="sm" variant="destructive" disabled={!canStop} onClick={() => runAction("stop")}>
          {acting && status !== "offline" ? "Stopping…" : "Stop Server"}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={!canDestroy}
          onClick={handleDestroyClick}
          className={confirmingDestroy ? "text-red-400 border border-red-400/40 animate-pulse" : "text-white/40 hover:text-red-400"}
        >
          {acting ? "Destroying…" : confirmingDestroy ? "Confirm — click again" : "Destroy All"}
        </Button>
      </div>

      {/* Step progress */}
      {steps.length > 0 && (
        <div className="border border-white/10 rounded-lg p-4">
          <StepProgress steps={steps} />
        </div>
      )}

      {/* Error */}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Logs */}
      {status !== "offline" && (
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={fetchingLogs}
            onClick={handleFetchLogs}
            className="self-start text-white/40 hover:text-white/70"
          >
            {fetchingLogs ? "Fetching logs…" : "Fetch Logs"}
          </Button>
          {logs && (
            <pre className="text-xs text-white/60 bg-white/5 border border-white/10 rounded-lg p-4 overflow-auto max-h-96 whitespace-pre-wrap break-all">
              {logs}
            </pre>
          )}
        </div>
      )}

      <p className="text-white/30 text-xs">
        Start before a game goes live, stop when it ends.
        Use <span className="text-white/50">Destroy All</span> to force-clean any orphaned AWS resources (EIPs, instances, SG, DNS) — even from failed starts.
      </p>
    </section>
  )
}
