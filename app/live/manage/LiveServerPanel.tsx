"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { LiveServerInfo, LiveServerStatus, DestroyAllResult } from "@/app/api/live-server/route"

const STATUS_DOT: Record<LiveServerStatus, string> = {
  online: "bg-green-400",
  starting: "bg-yellow-400 animate-pulse",
  stopping: "bg-yellow-400 animate-pulse",
  unhealthy: "bg-red-400",
  offline: "bg-white/20",
}

const STATUS_LABEL: Record<LiveServerStatus, string> = {
  online: "Online",
  starting: "Starting…",
  stopping: "Stopping…",
  unhealthy: "Unhealthy",
  offline: "Offline",
}

export function LiveServerPanel() {
  const [info, setInfo] = useState<LiveServerInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [destroying, setDestroying] = useState(false)
  const [confirmingDestroy, setConfirmingDestroy] = useState(false)
  const [destroyResult, setDestroyResult] = useState<DestroyAllResult | null>(null)
  const [error, setError] = useState("")
  const [logs, setLogs] = useState<string | null>(null)
  const [fetchingLogs, setFetchingLogs] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchStatus() {
    try {
      const res = await fetch("/api/live-server")
      if (res.ok) setInfo(await res.json())
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    intervalRef.current = setInterval(fetchStatus, 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    }
  }, [])

  async function handleAction(action: "start" | "stop") {
    setActing(true)
    setError("")
    setDestroyResult(null)
    try {
      const res = await fetch("/api/live-server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? "Request failed")
      } else {
        setInfo(d as LiveServerInfo)
        if (d.errors?.length) setError(d.errors.join(" · "))
      }
    } catch {
      setError("Network error")
    } finally {
      setActing(false)
      await fetchStatus()
    }
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
      // First click — arm the button, auto-reset after 5s
      setConfirmingDestroy(true)
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
      confirmTimeoutRef.current = setTimeout(() => setConfirmingDestroy(false), 5000)
    } else {
      // Second click — fire
      clearTimeout(confirmTimeoutRef.current!)
      setConfirmingDestroy(false)
      runDestroyAll()
    }
  }

  async function runDestroyAll() {
    setDestroying(true)
    setError("")
    setDestroyResult(null)
    try {
      const res = await fetch("/api/live-server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "destroy-all" }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? "Destroy failed")
      } else {
        setDestroyResult(d as DestroyAllResult)
      }
    } catch {
      setError("Network error")
    } finally {
      setDestroying(false)
      await fetchStatus()
    }
  }

  const status = info?.status ?? "offline"
  const canStart = !acting && !destroying && status === "offline"
  const canStop = !acting && !destroying && (status === "online" || status === "unhealthy" || status === "starting")
  const canDestroy = !acting && !destroying

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
              <span className="font-medium">{STATUS_LABEL[status]}</span>
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
        <Button size="sm" disabled={!canStart} onClick={() => handleAction("start")}>
          {acting && (status === "offline" || status === "starting") ? "Starting…" : "Start Server"}
        </Button>

        <Button size="sm" variant="destructive" disabled={!canStop} onClick={() => handleAction("stop")}>
          {acting && status !== "offline" ? "Stopping…" : "Stop Server"}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={!canDestroy}
          onClick={handleDestroyClick}
          className={confirmingDestroy ? "text-red-400 border border-red-400/40 animate-pulse" : "text-white/40 hover:text-red-400"}
        >
          {destroying ? "Destroying…" : confirmingDestroy ? "Confirm — click again" : "Destroy All"}
        </Button>
      </div>

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

      {/* Error display */}
      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {/* Destroy-all result */}
      {destroyResult && (
        <div className="border border-white/10 rounded-lg p-4 flex flex-col gap-2 text-sm">
          <p className="font-medium text-white/70">Destroy All — Complete</p>
          {destroyResult.terminated.length > 0 && (
            <p className="text-white/50">
              Terminated: <span className="font-mono text-white/70">{destroyResult.terminated.join(", ")}</span>
            </p>
          )}
          {destroyResult.releasedEips.length > 0 && (
            <p className="text-white/50">
              Released EIPs: <span className="font-mono text-white/70">{destroyResult.releasedEips.join(", ")}</span>
            </p>
          )}
          <p className="text-white/50">
            Security group: <span className={destroyResult.sgDeleted ? "text-green-400" : "text-white/30"}>
              {destroyResult.sgDeleted ? "deleted" : "not found / skipped"}
            </span>
          </p>
          <p className="text-white/50">
            DNS record: <span className={destroyResult.dnsDeleted ? "text-green-400" : "text-white/30"}>
              {destroyResult.dnsDeleted ? "deleted" : "not found / skipped"}
            </span>
          </p>
          {destroyResult.errors.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              {destroyResult.errors.map((e, i) => (
                <p key={i} className="text-red-400 text-xs">{e}</p>
              ))}
            </div>
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
