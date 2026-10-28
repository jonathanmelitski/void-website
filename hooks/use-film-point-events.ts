"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { PointEventItem } from "@/lib/aws/point-events"
import { eventNeedsPlayer } from "@/lib/point-event-meta"

// ─── Timeline math ────────────────────────────────────────────────────────────

/**
 * Point-relative film offsets (ms after the point's film marker) for one point's events.
 * A saved filmOffsetMs wins; otherwise spacing comes from the live createdAt times, first event at 0.
 */
export function resolveOffsets(pointEvents: PointEventItem[]): Map<string, number> {
  const byCreated = [...pointEvents].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sortOrder - b.sortOrder)
  const ref = byCreated.length > 0 ? Date.parse(byCreated[0].createdAt) : 0
  return new Map(pointEvents.map(ev => [ev.id, ev.filmOffsetMs ?? Date.parse(ev.createdAt) - ref]))
}

/** True when the event has everything the API requires (incomplete events stay local until fixed) */
export function isEventComplete(ev: PointEventItem): boolean {
  if (ev.eventType === "TIMEOUT") return ev.team === "VOID" || ev.team === "OPP"
  if (ev.eventType === "SUBSTITUTION") return !!ev.playerId && !!ev.playerInId
  return !eventNeedsPlayer(ev.eventType) || !!ev.playerId
}

// Pin every event to an explicit film offset (never before the point's start), then order sortOrder by film time
function normalizePoint(pointEvents: PointEventItem[]): PointEventItem[] {
  const offsets = resolveOffsets(pointEvents)
  return pointEvents
    .map(ev => ev.filmOffsetMs === undefined ? { ...ev, filmOffsetMs: offsets.get(ev.id)! } : ev)
    .map(ev => ev.filmOffsetMs! < 0 ? { ...ev, filmOffsetMs: 0 } : ev)
    .sort((a, b) => a.filmOffsetMs! - b.filmOffsetMs! || a.sortOrder - b.sortOrder)
    .map((ev, i) => ev.sortOrder === i + 1 ? ev : { ...ev, sortOrder: i + 1 })
}

function sameEvent(a: PointEventItem, b: PointEventItem) {
  return a.eventType === b.eventType && a.playerId === b.playerId && a.playerInId === b.playerInId &&
    a.team === b.team && a.sortOrder === b.sortOrder && a.filmOffsetMs === b.filmOffsetMs
}

// ─── Undo history ─────────────────────────────────────────────────────────────

const MAX_HISTORY = 300

type History = { past: PointEventItem[][]; present: PointEventItem[]; future: PointEventItem[][] }
type HistoryAction =
  | { type: "reset"; events: PointEventItem[] }
  | { type: "edit"; pointId: string; fn: (pointEvents: PointEventItem[]) => PointEventItem[] }
  | { type: "undo" }
  | { type: "redo" }

function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case "reset":
      return { past: [], present: action.events, future: [] }
    case "edit": {
      const before = state.present.filter(e => e.pointId === action.pointId)
      const after = normalizePoint(action.fn(normalizePoint(before)))
      const unchanged = after.length === before.length &&
        after.every(ev => { const prev = before.find(b => b.id === ev.id); return prev && sameEvent(prev, ev) })
      if (unchanged) return state
      const present = [...state.present.filter(e => e.pointId !== action.pointId), ...after]
      return { past: [...state.past, state.present].slice(-MAX_HISTORY), present, future: [] }
    }
    case "undo": {
      if (state.past.length === 0) return state
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] }
    }
    case "redo": {
      if (state.future.length === 0) return state
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
    }
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type SaveStatus = "saved" | "pending" | "saving" | "error"

type PointBatch = { pointId: string; upserts: PointEventItem[]; deletes: string[] }

const SAVE_DEBOUNCE_MS = 700

function toUpsert(ev: PointEventItem) {
  return {
    id: ev.id,
    eventType: ev.eventType,
    playerId: ev.playerId,
    playerInId: ev.playerInId,
    team: ev.team,
    sortOrder: ev.sortOrder,
    filmOffsetMs: ev.filmOffsetMs,
  }
}

/**
 * A game's point events as an editable document: undo/redo across points, debounced autosave
 * of each changed point through /api/point-events/batch.
 */
export function useFilmPointEvents(gameId: string) {
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: [], future: [] })
  const events = history.present
  // Server state as last loaded/saved — the autosave diff baseline
  const savedRef = useRef<Map<string, PointEventItem>>(new Map())
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveTick, setSaveTick] = useState(0)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    fetch(`/api/point-events?gameId=${gameId}`)
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
      .then((data: PointEventItem[]) => {
        if (cancelled) return
        const list = Array.isArray(data) ? data : []
        savedRef.current = new Map(list.map(e => [e.id, e]))
        dispatch({ type: "reset", events: list })
      })
    return () => { cancelled = true }
  }, [gameId])

  const computeBatches = useCallback((current: PointEventItem[]): PointBatch[] => {
    const saved = savedRef.current
    const byPoint = new Map<string, PointBatch>()
    const batchFor = (pointId: string) => {
      let b = byPoint.get(pointId)
      if (!b) { b = { pointId, upserts: [], deletes: [] }; byPoint.set(pointId, b) }
      return b
    }
    const currentIds = new Set(current.map(e => e.id))
    for (const ev of current) {
      if (!isEventComplete(ev)) continue
      const prev = saved.get(ev.id)
      if (!prev || !sameEvent(prev, ev)) batchFor(ev.pointId).upserts.push(ev)
    }
    for (const prev of saved.values()) {
      if (!currentIds.has(prev.id)) batchFor(prev.pointId).deletes.push(prev.id)
    }
    return [...byPoint.values()]
  }, [])

  const sendBatch = useCallback((b: PointBatch, keepalive = false) =>
    fetch("/api/point-events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointId: b.pointId, upserts: b.upserts.map(toUpsert), deletes: b.deletes }),
      keepalive,
    }), [])

  // Debounced autosave whenever the document diverges from the saved baseline
  const eventsRef = useRef(events)
  useEffect(() => { eventsRef.current = events })
  useEffect(() => {
    const batches = computeBatches(events)
    if (batches.length === 0) {
      if (!inFlightRef.current) setSaveStatus(s => s === "error" ? s : "saved")
      return
    }
    if (inFlightRef.current) return // re-checked when the in-flight save finishes
    setSaveStatus(s => s === "error" ? s : "pending")
    const timer = setTimeout(async () => {
      const toSave = computeBatches(eventsRef.current)
      if (toSave.length === 0) return
      inFlightRef.current = true
      setSaveStatus("saving")
      try {
        for (const b of toSave) {
          const res = await sendBatch(b)
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error((data as { error?: string }).error ?? "Save failed")
          }
          for (const ev of b.upserts) savedRef.current.set(ev.id, ev)
          for (const id of b.deletes) savedRef.current.delete(id)
        }
        setSaveError(null)
        setSaveStatus("saved")
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Save failed")
        setSaveStatus("error")
      } finally {
        inFlightRef.current = false
        setSaveTick(t => t + 1)
      }
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [events, saveTick, computeBatches, sendBatch])

  const retrySave = useCallback(() => {
    setSaveStatus("pending")
    setSaveError(null)
    setSaveTick(t => t + 1)
  }, [])

  // Don't lose edits: flush on unmount and warn before closing the tab with unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (computeBatches(eventsRef.current).length > 0) e.preventDefault()
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      for (const b of computeBatches(eventsRef.current)) sendBatch(b, true).catch(() => {})
    }
  }, [computeBatches, sendBatch])

  const editPoint = useCallback((pointId: string, fn: (pointEvents: PointEventItem[]) => PointEventItem[]) => {
    dispatch({ type: "edit", pointId, fn })
  }, [])
  const undo = useCallback(() => dispatch({ type: "undo" }), [])
  const redo = useCallback(() => dispatch({ type: "redo" }), [])

  const incompleteCount = useMemo(() => events.filter(e => !isEventComplete(e)).length, [events])

  return {
    events,
    editPoint,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saveStatus,
    saveError,
    retrySave,
    incompleteCount,
  }
}
