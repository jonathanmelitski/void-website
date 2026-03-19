"use client"

import { useEffect, useState } from "react"
import type { AuditLogEntry, AuditAction } from "@/lib/aws/audit"

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function actionBadgeClass(action: AuditAction): string {
  switch (action) {
    case "CREATE":
    case "PUBLISH":
      return "text-green-400/80 bg-green-400/10"
    case "UPDATE":
      return "text-yellow-400/80 bg-yellow-400/10"
    case "DELETE":
    case "UNPUBLISH":
      return "text-red-400/80 bg-red-400/10"
    case "ENTRY_ADD":
      return "text-blue-400/80 bg-blue-400/10"
    case "ENTRY_REMOVE":
      return "text-orange-400/80 bg-orange-400/10"
    default:
      return "text-white/40 bg-white/10"
  }
}

export function AuditPanel() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [revertTarget, setRevertTarget] = useState<AuditLogEntry | null>(null)
  const [isReverting, setIsReverting] = useState(false)
  const [revertError, setRevertError] = useState("")
  const [revertWarnings, setRevertWarnings] = useState<string[]>([])
  const [needsForce, setNeedsForce] = useState(false)

  useEffect(() => {
    fetch("/api/audit")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setEntries(data)
        else setError(data.error ?? "Failed to load audit logs")
      })
      .catch(() => setError("Failed to load audit logs"))
      .finally(() => setLoading(false))
  }, [])

  async function handleRevert(force: boolean) {
    if (!revertTarget) return
    setIsReverting(true)
    setRevertError("")

    try {
      const res = await fetch("/api/audit/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: revertTarget.id, force }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409 && data.blocking === true) {
          setRevertError(data.warnings?.join(" ") ?? data.error ?? "Conflict")
          setNeedsForce(false)
          setIsReverting(false)
          return
        }
        if (res.status === 409) {
          // Non-blocking warnings — show them and allow force
          setRevertWarnings(data.warnings ?? [])
          setNeedsForce(true)
          setIsReverting(false)
          return
        }
        setRevertError(data.error ?? "Revert failed")
        setIsReverting(false)
        return
      }

      // Success — update entry in state
      setEntries(prev =>
        prev.map(e =>
          e.id === revertTarget.id
            ? { ...e, revertedBy: "you", revertedAt: new Date().toISOString() }
            : e
        )
      )
      setRevertTarget(null)
      setRevertWarnings([])
      setNeedsForce(false)
    } catch {
      setRevertError("Network error")
    } finally {
      setIsReverting(false)
    }
  }

  function openRevert(entry: AuditLogEntry) {
    setRevertTarget(entry)
    setRevertError("")
    setRevertWarnings([])
    setNeedsForce(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return <p className="text-red-400 text-sm">{error}</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <span className="text-white/40 text-xs">{entries.length} entries</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-white/40 text-sm">No audit log entries yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/30 text-xs border-b border-white/10">
                <th className="text-left pb-2 pr-4 font-medium">When</th>
                <th className="text-left pb-2 pr-4 font-medium">Who</th>
                <th className="text-left pb-2 pr-4 font-medium">Action</th>
                <th className="text-left pb-2 pr-4 font-medium">Entity</th>
                <th className="text-left pb-2 pr-4 font-medium">Status</th>
                <th className="text-left pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-4 text-white/40 whitespace-nowrap">
                    <span title={entry.timestamp}>{timeAgo(entry.timestamp)}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-white/70 max-w-[120px] truncate">
                    {entry.actorUsername}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionBadgeClass(entry.action)}`}
                    >
                      {entry.action}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-white/70 max-w-[180px] truncate">
                    <span className="text-white/30 text-xs mr-1">{entry.entityType}</span>
                    {entry.entityLabel}
                  </td>
                  <td className="py-2.5 pr-4">
                    {entry.revertedBy ? (
                      <span className="text-white/30 text-xs">
                        Reverted by {entry.revertedBy}
                      </span>
                    ) : (
                      <span className="text-white/20 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    {entry.reversible && !entry.revertedBy && (
                      <button
                        onClick={() => openRevert(entry)}
                        className="text-xs text-white/40 hover:text-white/80 transition-colors"
                      >
                        Revert
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm dialog */}
      {revertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 flex flex-col gap-4">
            <h3 className="font-semibold">Undo {revertTarget.action}?</h3>
            <p className="text-white/60 text-sm">
              Revert <span className="font-medium text-white/80">{revertTarget.action}</span> of{" "}
              <span className="font-medium text-white/80">{revertTarget.entityLabel}</span>?
            </p>

            {revertWarnings.length > 0 && (
              <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-3 flex flex-col gap-1">
                {revertWarnings.map((w, i) => (
                  <p key={i} className="text-yellow-400/80 text-xs">{w}</p>
                ))}
              </div>
            )}

            {revertError && (
              <p className="text-red-400 text-sm">{revertError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setRevertTarget(null)
                  setRevertWarnings([])
                  setNeedsForce(false)
                  setRevertError("")
                }}
                className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
                disabled={isReverting}
              >
                Cancel
              </button>
              <button
                onClick={() => handleRevert(needsForce)}
                disabled={isReverting}
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isReverting ? "Reverting…" : needsForce ? "Revert anyway" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
