"use client"

import React, { useEffect, useState, useMemo } from "react"
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
    case "SEND":
      return "text-purple-400/80 bg-purple-400/10"
    default:
      return "text-white/40 bg-white/10"
  }
}

const GROUP_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const LONG_FIELDS = new Set(["body", "emailBody"])
const SKIP_DIFF_KEYS = new Set(["id", "newsletterId", "entries"])

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, "").trim()
}

function renderShort(v: unknown, limit = 120): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "boolean") return v ? "true" : "false"
  if (typeof v === "string") {
    const s = stripHtml(v)
    return s.length > limit ? s.slice(0, limit) + "…" : s || "—"
  }
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.length} items]`
  return String(v).slice(0, limit)
}

function renderLong(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return stripHtml(v)
  return String(v)
}

function DiffField({
  fieldKey,
  prev,
  next,
  large,
}: {
  fieldKey: string
  prev: unknown
  next: unknown
  large: boolean
}) {
  const isLong = large && LONG_FIELDS.has(fieldKey)

  if (isLong) {
    const prevText = renderLong(prev)
    const nextText = renderLong(next)
    return (
      <div className="flex flex-col gap-2">
        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">{fieldKey}</span>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-red-400/50 text-[10px] uppercase tracking-wider font-medium">Before</span>
            <div className="bg-red-400/5 border border-red-400/10 rounded-lg p-3 text-xs text-red-300/70 font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto leading-relaxed">
              {prevText || <span className="text-white/20 italic">empty</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-green-400/50 text-[10px] uppercase tracking-wider font-medium">After</span>
            <div className="bg-green-400/5 border border-green-400/10 rounded-lg p-3 text-xs text-green-300/70 font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto leading-relaxed">
              {nextText || <span className="text-white/20 italic">empty</span>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`text-xs grid items-start gap-x-3 ${large ? "grid-cols-[120px_1fr]" : "grid-cols-[100px_1fr]"}`}>
      <span className="text-white/30 font-mono pt-0.5">{fieldKey}</span>
      <div className="flex flex-col gap-0.5">
        {prev !== undefined && (
          <span className="text-red-400/70 bg-red-400/5 rounded px-1.5 py-0.5 font-mono break-all">
            − {renderShort(prev, large ? 300 : 120)}
          </span>
        )}
        {next !== undefined && (
          <span className="text-green-400/70 bg-green-400/5 rounded px-1.5 py-0.5 font-mono break-all">
            + {renderShort(next, large ? 300 : 120)}
          </span>
        )}
      </div>
    </div>
  )
}

function DiffView({
  prev,
  next,
  large = false,
}: {
  prev: Record<string, unknown>
  next: Record<string, unknown>
  large?: boolean
}) {
  const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]))
    .filter(k => !SKIP_DIFF_KEYS.has(k))
  const changed = keys.filter(k => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))
  // Long fields last so they don't interrupt the compact fields
  const sorted = [
    ...changed.filter(k => !LONG_FIELDS.has(k)),
    ...changed.filter(k => LONG_FIELDS.has(k)),
  ]

  if (sorted.length === 0) return <p className="text-white/30 text-xs">No field changes recorded.</p>

  return (
    <div className={`flex flex-col ${large ? "gap-5" : "gap-1.5"}`}>
      {sorted.map(k => (
        <DiffField
          key={k}
          fieldKey={k}
          prev={k in prev ? prev[k] : undefined}
          next={k in next ? next[k] : undefined}
          large={large}
        />
      ))}
    </div>
  )
}

function SendDetail({ state }: { state: Record<string, unknown> }) {
  const fields: [string, string][] = ([
    ["Newsletter", state.newsletterTitle as string],
    ["Subject", state.subject as string],
    ["List", state.listName as string],
    ["To", state.toEmail as string],
    ["From", state.fromName as string],
    ["Reply-to", state.replyTo as string],
    ["Recipients", String(state.recipientCount ?? "")],
    ["Tracking", state.trackingEnabled ? "enabled" : "disabled"],
  ] as [string, string][]).filter(([, v]) => v)

  return (
    <div className="flex flex-col gap-1">
      {fields.map(([label, value]) => (
        <div key={label} className="text-xs grid grid-cols-[80px_1fr] gap-x-3">
          <span className="text-white/30">{label}</span>
          <span className="text-white/60 font-mono">{value}</span>
        </div>
      ))}
    </div>
  )
}

// --- Grouping ---

type SingleItem = { kind: "single"; entry: AuditLogEntry }
type GroupItem  = { kind: "group";  entries: AuditLogEntry[]; groupId: string }
type ListItem   = SingleItem | GroupItem

function groupEntries(entries: AuditLogEntry[]): ListItem[] {
  const result: ListItem[] = []
  let i = 0

  while (i < entries.length) {
    const e = entries[i]
    const bucket: AuditLogEntry[] = [e]
    let j = i + 1

    while (j < entries.length) {
      const next = entries[j]
      const sameEntity = next.entityId === e.entityId && next.entityType === e.entityType
      const withinWindow =
        Math.abs(
          new Date(e.timestamp).getTime() - new Date(next.timestamp).getTime()
        ) <= GROUP_WINDOW_MS
      if (sameEntity && withinWindow) {
        bucket.push(next)
        j++
      } else {
        break
      }
    }

    if (bucket.length > 1) {
      result.push({ kind: "group", entries: bucket, groupId: bucket[0].id })
    } else {
      result.push({ kind: "single", entry: e })
    }
    i = j
  }

  return result
}

// --- Entry row (reused for both flat and inside-group views) ---

function EntryRow({
  entry,
  expandedId,
  setExpandedId,
  openRevert,
  indent = false,
  large = false,
}: {
  entry: AuditLogEntry
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  openRevert: (e: AuditLogEntry) => void
  indent?: boolean
  large?: boolean
}) {
  const hasDetail =
    entry.action === "SEND"
      ? !!entry.newState
      : entry.action === "UPDATE" && !!(entry.previousState && entry.newState)
  const isExpanded = expandedId === entry.id

  return (
    <React.Fragment key={entry.id}>
      <tr
        className={`border-b border-white/5 ${hasDetail ? "cursor-pointer" : ""} hover:bg-white/[0.02]`}
        onClick={hasDetail ? () => setExpandedId(isExpanded ? null : entry.id) : undefined}
      >
        <td className={`py-2.5 pr-4 text-white/40 whitespace-nowrap ${indent ? "pl-6" : ""}`}>
          <span title={entry.timestamp}>{timeAgo(entry.timestamp)}</span>
        </td>
        <td className="py-2.5 pr-4 text-white/70 max-w-[120px] truncate">
          {entry.actorUsername}
        </td>
        <td className="py-2.5 pr-4">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionBadgeClass(entry.action)}`}>
            {entry.action}
          </span>
        </td>
        <td className="py-2.5 pr-4 text-white/70 max-w-[180px] truncate">
          <span className="text-white/30 text-xs mr-1">{entry.entityType}</span>
          {entry.entityLabel}
        </td>
        <td className="py-2.5 pr-4">
          {entry.revertedBy ? (
            <span className="text-white/30 text-xs">Reverted by {entry.revertedBy}</span>
          ) : (
            <span className="text-white/20 text-xs">—</span>
          )}
        </td>
        <td className="py-2.5">
          <div className="flex items-center gap-3">
            {hasDetail && (
              <span className="text-xs text-white/30">{isExpanded ? "▲" : "▼"}</span>
            )}
            {entry.reversible && !entry.revertedBy && (
              <button
                onClick={ev => { ev.stopPropagation(); openRevert(entry) }}
                className="text-xs text-white/40 hover:text-white/80 transition-colors"
              >
                Revert
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && hasDetail && (
        <tr className="border-b border-white/5 bg-white/[0.015]">
          <td colSpan={6} className={`px-5 py-4 ${indent ? "pl-10" : ""}`}>
            {entry.action === "SEND" && entry.newState ? (
              <SendDetail state={entry.newState} />
            ) : entry.action === "UPDATE" && entry.previousState && entry.newState ? (
              <DiffView prev={entry.previousState} next={entry.newState} large={large} />
            ) : null}
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// --- Group row ---

function GroupRow({
  item,
  expandedGroupId,
  setExpandedGroupId,
  expandedId,
  setExpandedId,
  openRevert,
  openGroupRevert,
}: {
  item: GroupItem
  expandedGroupId: string | null
  setExpandedGroupId: (id: string | null) => void
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  openRevert: (e: AuditLogEntry) => void
  openGroupRevert: (g: GroupItem) => void
}) {
  const isOpen = expandedGroupId === item.groupId
  const { entries } = item
  const newest = entries[0]
  const oldest = entries[entries.length - 1]
  const actions = Array.from(new Set(entries.map(e => e.action)))
  const actors  = Array.from(new Set(entries.map(e => e.actorUsername)))

  // Net diff: oldest previousState → newest newState
  const baselineEntry = [...entries].reverse().find(e => e.previousState)
  const finalEntry    = entries.find(e => e.newState)
  const netPrev = baselineEntry?.previousState
  const netNext = finalEntry?.newState
  const hasNetDiff = !!(netPrev && netNext)

  const reversibleCount = entries.filter(e => e.reversible && !e.revertedBy).length

  return (
    <React.Fragment key={item.groupId}>
      <tr
        className="border-b border-white/5 cursor-pointer hover:bg-white/[0.02] bg-white/[0.01]"
        onClick={() => setExpandedGroupId(isOpen ? null : item.groupId)}
      >
        <td className="py-2.5 pr-4 text-white/40 whitespace-nowrap">
          <span title={`${oldest.timestamp} → ${newest.timestamp}`}>
            {timeAgo(newest.timestamp)}
          </span>
        </td>
        <td className="py-2.5 pr-4 text-white/60 max-w-[120px] truncate">
          {actors.join(", ")}
        </td>
        <td className="py-2.5 pr-4">
          <div className="flex items-center gap-1 flex-wrap">
            {actions.map(a => (
              <span
                key={a}
                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionBadgeClass(a)}`}
              >
                {a}
              </span>
            ))}
          </div>
        </td>
        <td className="py-2.5 pr-4 text-white/70 max-w-[180px] truncate">
          <span className="text-white/30 text-xs mr-1">{newest.entityType}</span>
          {newest.entityLabel}
        </td>
        <td className="py-2.5 pr-4">
          <span className="text-xs text-white/40 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
            {entries.length} changes
          </span>
        </td>
        <td className="py-2.5">
          <div className="flex items-center gap-3">
            {reversibleCount > 0 && (
              <button
                onClick={ev => { ev.stopPropagation(); openGroupRevert(item) }}
                className="text-xs text-white/40 hover:text-white/80 transition-colors"
              >
                Revert all
              </button>
            )}
            <span className="text-xs text-white/30">{isOpen ? "▲" : "▼"}</span>
          </div>
        </td>
      </tr>
      {isOpen && (
        <>
          {entries.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              openRevert={openRevert}
              indent
              large={false}
            />
          ))}
          {hasNetDiff && (
            <tr className="border-b border-white/5">
              <td colSpan={6} className="px-6 py-5 bg-white/[0.02]">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                      Net changes · {newest.entityLabel}
                    </span>
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-[10px] text-white/25">
                      {timeAgo(oldest.timestamp)} → {timeAgo(newest.timestamp)}
                    </span>
                  </div>
                  <DiffView prev={netPrev} next={netNext} large />
                </div>
              </td>
            </tr>
          )}
        </>
      )}
    </React.Fragment>
  )
}

// --- Main panel ---

export function AuditPanel() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [grouped, setGrouped] = useState(false)
  const [showReverted, setShowReverted] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  // single revert
  const [revertTarget, setRevertTarget] = useState<AuditLogEntry | null>(null)
  const [isReverting, setIsReverting] = useState(false)
  const [revertError, setRevertError] = useState("")
  const [revertWarnings, setRevertWarnings] = useState<string[]>([])
  const [needsForce, setNeedsForce] = useState(false)
  // group revert
  const [groupRevertTarget, setGroupRevertTarget] = useState<GroupItem | null>(null)
  const [isGroupReverting, setIsGroupReverting] = useState(false)
  const [groupRevertError, setGroupRevertError] = useState("")
  const [groupRevertProgress, setGroupRevertProgress] = useState<{ done: number; total: number } | null>(null)

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

  const visibleEntries = useMemo(
    () => showReverted ? entries : entries.filter(e => !e.revertedBy),
    [entries, showReverted]
  )

  const listItems = useMemo<ListItem[]>(
    () => grouped ? groupEntries(visibleEntries) : visibleEntries.map(e => ({ kind: "single", entry: e })),
    [visibleEntries, grouped]
  )

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
          setRevertWarnings(data.warnings ?? [])
          setNeedsForce(true)
          setIsReverting(false)
          return
        }
        setRevertError(data.error ?? "Revert failed")
        setIsReverting(false)
        return
      }

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

  function openGroupRevert(group: GroupItem) {
    setGroupRevertTarget(group)
    setGroupRevertError("")
    setGroupRevertProgress(null)
  }

  async function handleGroupRevert() {
    if (!groupRevertTarget) return
    const toRevert = groupRevertTarget.entries.filter(e => e.reversible && !e.revertedBy)
    if (toRevert.length === 0) return

    setIsGroupReverting(true)
    setGroupRevertError("")
    setGroupRevertProgress({ done: 0, total: toRevert.length })

    let failed = 0
    for (let i = 0; i < toRevert.length; i++) {
      const entry = toRevert[i]
      try {
        const res = await fetch("/api/audit/revert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id, force: true }),
        })
        if (res.ok) {
          setEntries(prev =>
            prev.map(e =>
              e.id === entry.id
                ? { ...e, revertedBy: "you", revertedAt: new Date().toISOString() }
                : e
            )
          )
        } else {
          failed++
        }
      } catch {
        failed++
      }
      setGroupRevertProgress({ done: i + 1, total: toRevert.length })
    }

    setIsGroupReverting(false)
    if (failed > 0) {
      setGroupRevertError(`${failed} of ${toRevert.length} reverts failed.`)
    } else {
      setGroupRevertTarget(null)
      setGroupRevertProgress(null)
    }
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

  const groupCount = listItems.filter(i => i.kind === "group").length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setGrouped(g => !g)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              grouped
                ? "bg-white/10 border-white/20 text-white/80"
                : "bg-transparent border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
            }`}
          >
            {grouped
              ? groupCount > 0
                ? `Grouped · ${groupCount} group${groupCount !== 1 ? "s" : ""}`
                : "Grouped"
              : "Group similar"}
          </button>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-white/40 hover:text-white/60 transition-colors">
            <input
              type="checkbox"
              checked={showReverted}
              onChange={e => setShowReverted(e.target.checked)}
              className="accent-white w-3 h-3"
            />
            Show reverted
          </label>
          <span className="text-white/40 text-xs">{visibleEntries.length} entries</span>
        </div>
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
              {listItems.map(item =>
                item.kind === "single" ? (
                  <EntryRow
                    key={item.entry.id}
                    entry={item.entry}
                    expandedId={expandedId}
                    setExpandedId={setExpandedId}
                    openRevert={openRevert}
                    large
                  />
                ) : (
                  <GroupRow
                    key={item.groupId}
                    item={item}
                    expandedGroupId={expandedGroupId}
                    setExpandedGroupId={setExpandedGroupId}
                    expandedId={expandedId}
                    setExpandedId={setExpandedId}
                    openRevert={openRevert}
                    openGroupRevert={openGroupRevert}
                  />
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Group revert dialog */}
      {groupRevertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 flex flex-col gap-4">
            <h3 className="font-semibold">Revert all changes in group?</h3>
            <div className="text-sm text-white/60 flex flex-col gap-1">
              <p>
                <span className="text-white/30">Entity:</span>{" "}
                {groupRevertTarget.entries[0].entityLabel}
              </p>
              <p>
                <span className="text-white/30">Reversible changes:</span>{" "}
                {groupRevertTarget.entries.filter(e => e.reversible && !e.revertedBy).length} of{" "}
                {groupRevertTarget.entries.length}
              </p>
            </div>
            <p className="text-xs text-yellow-400/70 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-2">
              Each change will be reverted newest-first. Conflicts will be skipped with force. This restores the entity to its state before this editing session.
            </p>
            {groupRevertProgress && (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs text-white/40">
                  <span>Reverting…</span>
                  <span>{groupRevertProgress.done} / {groupRevertProgress.total}</span>
                </div>
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/40 rounded-full transition-all"
                    style={{ width: `${(groupRevertProgress.done / groupRevertProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {groupRevertError && <p className="text-red-400 text-xs">{groupRevertError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setGroupRevertTarget(null); setGroupRevertProgress(null); setGroupRevertError("") }}
                disabled={isGroupReverting}
                className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                {groupRevertError ? "Close" : "Cancel"}
              </button>
              {!groupRevertError && (
                <button
                  onClick={handleGroupRevert}
                  disabled={isGroupReverting}
                  className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isGroupReverting ? "Reverting…" : "Revert all"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Revert confirm dialog */}
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

            {revertError && <p className="text-red-400 text-sm">{revertError}</p>}

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
