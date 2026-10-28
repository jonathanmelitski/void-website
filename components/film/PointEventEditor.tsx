"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import {
  AlertCircle, Check, ChevronRight, Keyboard, Loader2, Magnet, Maximize2, Pencil, Redo2, Trash2, Undo2, ZoomIn, ZoomOut,
} from "lucide-react"
import type { PointEventItem } from "@/lib/aws/point-events"
import type { PointItem } from "@/lib/aws/points"
import type { PlayerItem } from "@/lib/aws/players"
import { POINT_EVENT_META, POINT_EVENT_TYPES, eventNeedsPlayer, type PointEventType } from "@/lib/point-event-meta"
import { isEventComplete, resolveOffsets, type SaveStatus } from "@/hooks/use-film-point-events"
import { PlayerPicker, type PickerMode } from "./PlayerPicker"
import { LineEditor } from "./LineEditor"

interface PointEventEditorProps {
  point: PointItem
  events: PointEventItem[]           // this point's events
  players: PlayerItem[]
  /** Default visible window, ms relative to the point's film marker */
  rangeMs: [number, number]
  /** Point-relative playhead, read every frame */
  getPlayheadMs: () => number
  onSeek: (pointMs: number) => void
  onEdit: (fn: (pointEvents: PointEventItem[]) => PointEventItem[]) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  saveStatus: SaveStatus
  saveError: string | null
  onRetrySave: () => void
  onSaveLine: (playerIds: string[]) => Promise<void>
  isPaused: boolean
  /** Edit mode: when false the timeline is a read-only visualization (click to jump, Tab to step) */
  editable: boolean
  /** Present only for users allowed to edit (coaches/admins) */
  onToggleEdit?: () => void
  /** Collapse the editor to a one-line bar to free space for video */
  onCollapse?: () => void
}

// ─── Layout constants ────────────────────────────────────────────────────────

const GUTTER = 52           // lane label column
const RULER_H = 22
const CHIP_H = 18
const ROW_GAP = 3
const LANES = [
  { key: "play" as const, label: "Play", rows: 3 },
  { key: "stoppage" as const, label: "Bench", rows: 1 },
]
const LANE_PAD = 5
const laneHeight = (rows: number) => LANE_PAD * 2 + rows * CHIP_H + (rows - 1) * ROW_GAP
const LANE_TOPS = LANES.map((_, i) => RULER_H + LANES.slice(0, i).reduce((sum, l) => sum + laneHeight(l.rows), 0))
const TRACKS_HEIGHT = RULER_H + LANES.reduce((sum, l) => sum + laneHeight(l.rows), 0)
const SNAP_PX = 8
const DRAG_THRESHOLD_PX = 3
const MIN_SPAN_MS = 1500
const MAX_SPAN_MS = 10 * 60_000
const TICK_STEPS = [100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000]

function formatPointTime(ms: number, precise: boolean) {
  const sign = ms < 0 ? "-" : ""
  const abs = Math.abs(ms)
  const m = Math.floor(abs / 60_000)
  const s = (abs % 60_000) / 1000
  const sec = precise ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0")
  return `${sign}${m}:${sec}`
}

type View = { start: number; end: number }

type Drag = {
  kind: "chips"
  pointerId: number
  originX: number
  ids: string[]
  clickedId: string
  plainClick: boolean
  moved: boolean
  deltaMs: number
  snapMs: number | null
}
type Marquee = {
  kind: "marquee"
  pointerId: number
  x0: number
  y0: number
  x1: number
  y1: number
  additive: boolean
  base: Set<string>
  moved: boolean
}
type Scrub = { kind: "scrub"; pointerId: number }
type Interaction = Drag | Marquee | Scrub | null

type PickerState = {
  draft: PointEventItem
  existing: boolean
  step: "player" | "out" | "in" | "team"
}

/** True when a control has focus that Enter/Space/Tab/Backspace should keep operating natively */
export function controlHasFocus() {
  const el = document.activeElement
  return el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el instanceof HTMLSelectElement
}

function pickerStepFor(type: PointEventType): PickerState["step"] | null {
  if (type === "SUBSTITUTION") return "out"
  if (type === "TIMEOUT") return "team"
  return eventNeedsPlayer(type) ? "player" : null
}

export function PointEventEditor({
  point, events, players, rangeMs, getPlayheadMs, onSeek, onEdit,
  undo, redo, canUndo, canRedo, saveStatus, saveError, onRetrySave, onSaveLine, isPaused,
  editable, onToggleEdit, onCollapse,
}: PointEventEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const playheadLabelRef = useRef<HTMLSpanElement>(null)

  const [width, setWidth] = useState(0)
  const [view, setView] = useState<View>({ start: rangeMs[0], end: rangeMs[1] })
  const viewRef = useRef(view)
  useLayoutEffect(() => { viewRef.current = view }, [view])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [interaction, setInteraction] = useState<Interaction>(null)
  const interactionRef = useRef<Interaction>(null)
  const setInter = (i: Interaction) => { interactionRef.current = i; setInteraction(i) }

  const [picker, setPicker] = useState<PickerState | null>(null)
  const [lineOpen, setLineOpen] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [iframeHasFocus, setIframeHasFocus] = useState(false)

  const [wasEditable, setWasEditable] = useState(editable)
  if (wasEditable !== editable) {
    setWasEditable(editable)
    if (!editable) { setPicker(null); setLineOpen(false) }
  }

  // Reset view + selection when switching points
  const [viewPointId, setViewPointId] = useState(point.id)
  if (viewPointId !== point.id) {
    setViewPointId(point.id)
    setView({ start: rangeMs[0], end: rangeMs[1] })
    setSelected(new Set())
    setPicker(null)
    setLineOpen(false)
  }

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // YouTube's iframe swallows key events once clicked — surface that so shortcuts never silently die
  useEffect(() => {
    const onBlur = () => setTimeout(() => setIframeHasFocus(document.activeElement?.tagName === "IFRAME"), 0)
    const onFocus = () => setIframeHasFocus(false)
    window.addEventListener("blur", onBlur)
    window.addEventListener("focus", onFocus)
    return () => { window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus) }
  }, [])
  const reclaimFocus = () => {
    (document.activeElement as HTMLElement | null)?.blur?.()
    rootRef.current?.focus()
    setIframeHasFocus(false)
  }

  // ─── Coordinates ───────────────────────────────────────────────────────────

  const span = view.end - view.start
  const pxPerMs = width > 0 ? width / span : 0
  const msToX = useCallback((ms: number) => (ms - view.start) * pxPerMs, [view.start, pxPerMs])
  const xToMs = useCallback((x: number) => view.start + x / (pxPerMs || 1), [view.start, pxPerMs])
  const localX = (clientX: number) => clientX - (trackRef.current?.getBoundingClientRect().left ?? 0)
  const localY = (clientY: number) => clientY - (trackRef.current?.getBoundingClientRect().top ?? 0)

  const offsets = useMemo(() => resolveOffsets(events), [events])
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => offsets.get(a.id)! - offsets.get(b.id)! || a.sortOrder - b.sortOrder),
    [events, offsets]
  )

  const drag = interaction?.kind === "chips" && interaction.moved ? interaction : null
  const displayOffset = useCallback((ev: PointEventItem) => {
    const base = offsets.get(ev.id) ?? ev.filmOffsetMs ?? 0
    return drag && drag.ids.includes(ev.id) ? base + drag.deltaMs : base
  }, [offsets, drag])

  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const chipLabel = useCallback((ev: PointEventItem) => {
    const meta = POINT_EVENT_META[ev.eventType]
    if (ev.eventType === "TIMEOUT") return `${meta.short} ${ev.team === "VOID" ? "Void" : ev.team === "OPP" ? "Opp" : "?"}`
    if (ev.eventType === "SUBSTITUTION") {
      const out = playerById.get(ev.playerId)
      const inn = ev.playerInId ? playerById.get(ev.playerInId) : undefined
      return `${meta.short} ${out ? `#${out.number}` : "?"}→${inn ? `#${inn.number}` : "?"}`
    }
    if (!eventNeedsPlayer(ev.eventType)) return meta.short
    const p = playerById.get(ev.playerId)
    return `${meta.short} ${p ? `#${p.number}` : "?"}`
  }, [playerById])

  const describe = useCallback((ev: PointEventItem) => {
    if (ev.eventType === "TIMEOUT") return ev.team === "VOID" ? "Void" : ev.team === "OPP" ? "Opponent" : "Team?"
    const name = (id?: string) => {
      const p = id ? playerById.get(id) : undefined
      return p ? `#${p.number} ${p.first_name} ${p.last_name}` : "—"
    }
    if (ev.eventType === "SUBSTITUTION") return `${name(ev.playerId)} → ${name(ev.playerInId)}`
    return eventNeedsPlayer(ev.eventType) ? name(ev.playerId) : ""
  }, [playerById])

  // ─── Chip layout (greedy row packing per lane) ─────────────────────────────


  const ghost = picker && !picker.existing ? picker.draft : null

  const chips = useMemo(() => {
    const all = ghost ? [...sortedEvents, ghost] : sortedEvents
    const out: { ev: PointEventItem; x: number; y: number; w: number; label: string; ghost: boolean }[] = []
    LANES.forEach((lane, li) => {
      const rowEnds: number[] = Array(lane.rows).fill(-Infinity)
      const laneEvents = all
        .filter(ev => POINT_EVENT_META[ev.eventType].lane === lane.key)
        .map(ev => ({ ev, x: msToX(displayOffset(ev)) }))
        .sort((a, b) => a.x - b.x)
      for (const { ev, x } of laneEvents) {
        const label = chipLabel(ev)
        const w = 14 + label.length * 6.2
        let row = rowEnds.findIndex(end => x >= end + 2)
        if (row === -1) row = rowEnds.indexOf(Math.min(...rowEnds))
        rowEnds[row] = x + w
        out.push({ ev, x, w, label, ghost: ev === ghost, y: LANE_TOPS[li] + LANE_PAD + row * (CHIP_H + ROW_GAP) })
      }
    })
    return out
  }, [sortedEvents, ghost, msToX, displayOffset, chipLabel])

  // ─── Ruler ticks ───────────────────────────────────────────────────────────

  const ticks = useMemo(() => {
    if (pxPerMs <= 0) return { step: 1000, list: [] as number[] }
    const step = TICK_STEPS.find(s => s * pxPerMs >= 64) ?? TICK_STEPS[TICK_STEPS.length - 1]
    const list: number[] = []
    for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) list.push(t)
    return { step, list }
  }, [pxPerMs, view.start, view.end])

  // ─── Playhead (RAF, no re-render) + auto-follow while playing ──────────────

  const isPausedRef = useRef(isPaused)
  useLayoutEffect(() => { isPausedRef.current = isPaused }, [isPaused])
  const widthRef = useRef(width)
  useLayoutEffect(() => { widthRef.current = width }, [width])

  useEffect(() => {
    let raf: number
    const tick = () => {
      const v = viewRef.current
      const w = widthRef.current
      const ph = getPlayheadMs()
      if (w > 0) {
        const x = (ph - v.start) * (w / (v.end - v.start))
        if (playheadRef.current) {
          playheadRef.current.style.transform = `translateX(${x}px)`
          playheadRef.current.style.opacity = x < -1 || x > w + 1 ? "0" : "1"
        }
        if (playheadLabelRef.current) playheadLabelRef.current.textContent = formatPointTime(ph, true)
        const s = v.end - v.start
        if (!isPausedRef.current && !interactionRef.current && (ph > v.end - s * 0.05 || ph < v.start)) {
          const start = ph - s * 0.1
          setView({ start, end: start + s })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getPlayheadMs])

  // ─── Zoom / pan ────────────────────────────────────────────────────────────

  const zoomAround = useCallback((factor: number, anchorMs?: number) => {
    setView(v => {
      const s = v.end - v.start
      const ns = Math.min(MAX_SPAN_MS, Math.max(MIN_SPAN_MS, s * factor))
      const anchor = anchorMs ?? getPlayheadMs()
      const ratio = Math.min(1, Math.max(0, s > 0 ? (anchor - v.start) / s : 0.5))
      const start = anchor - ns * ratio
      return { start, end: start + ns }
    })
  }, [getPlayheadMs])

  const fitView = useCallback(() => {
    const offs = [...offsets.values()]
    const lo = Math.min(rangeMs[0], ...offs.map(o => o - 1000))
    const hi = Math.max(rangeMs[1], ...offs.map(o => o + 1500))
    setView({ start: lo, end: Math.max(hi, lo + MIN_SPAN_MS) })
  }, [offsets, rangeMs])

  // Non-passive wheel: pinch / ctrl-wheel zooms at the cursor, otherwise pans
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const v = viewRef.current
      const w = rect.width || 1
      if (e.ctrlKey || e.metaKey) {
        const anchor = v.start + ((e.clientX - rect.left) / w) * (v.end - v.start)
        zoomAround(Math.exp(e.deltaY * 0.01), anchor)
      } else {
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * ((v.end - v.start) / w)
        setView({ start: v.start + delta, end: v.end + delta })
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomAround])

  // ─── Editing operations ────────────────────────────────────────────────────

  // Moves never take an event before the point's start: the group stops when its earliest event hits 0
  const clampDelta = useCallback((ids: Iterable<string>, deltaMs: number) => {
    let earliest = Infinity
    for (const id of ids) earliest = Math.min(earliest, offsets.get(id) ?? 0)
    return earliest === Infinity ? deltaMs : Math.max(deltaMs, -earliest)
  }, [offsets])

  const shiftEvents = useCallback((ids: Iterable<string>, deltaMs: number) => {
    const set = new Set(ids)
    const delta = clampDelta(set, deltaMs)
    if (set.size === 0 || delta === 0) return
    onEdit(evs => evs.map(e => set.has(e.id) ? { ...e, filmOffsetMs: e.filmOffsetMs! + delta } : e))
  }, [onEdit, clampDelta])

  const earliestSelected = useCallback(
    () => sortedEvents.find(e => selected.has(e.id)) ?? null,
    [sortedEvents, selected]
  )

  const deleteSelected = useCallback(() => {
    if (selected.size === 0) return
    const ids = new Set(selected)
    onEdit(evs => evs.filter(e => !ids.has(e.id)))
    setSelected(new Set())
  }, [selected, onEdit])

  const addEvent = useCallback((type: PointEventType) => {
    const draft: PointEventItem = {
      id: crypto.randomUUID(),
      pointId: point.id,
      gameId: point.gameId,
      eventType: type,
      playerId: "",
      sortOrder: 0,
      filmOffsetMs: Math.max(0, Math.round(getPlayheadMs())),
      createdAt: new Date().toISOString(),
    }
    const step = pickerStepFor(type)
    if (!step) {
      onEdit(evs => [...evs, draft])
      setSelected(new Set([draft.id]))
      return
    }
    // Nothing is committed until a player is picked — Esc cancels a mistaken hotkey cleanly
    setPicker({ draft, existing: false, step })
  }, [point.id, point.gameId, getPlayheadMs, onEdit])

  const editPlayers = useCallback((ev: PointEventItem) => {
    const step = pickerStepFor(ev.eventType)
    if (step) setPicker({ draft: { ...ev }, existing: true, step })
  }, [])

  const changeType = useCallback((ev: PointEventItem, type: PointEventType) => {
    onEdit(evs => evs.map(e => {
      if (e.id !== ev.id) return e
      const next: PointEventItem = { ...e, eventType: type }
      if (type !== "SUBSTITUTION") delete next.playerInId
      if (type !== "TIMEOUT") delete next.team
      if (!eventNeedsPlayer(type)) next.playerId = ""
      return next
    }))
  }, [onEdit])

  const focusEditor = () => requestAnimationFrame(() => rootRef.current?.focus())

  const finishPicker = useCallback((draft: PointEventItem, existing: boolean) => {
    if (existing) onEdit(evs => evs.map(e => e.id === draft.id ? draft : e))
    else onEdit(evs => [...evs, draft])
    setSelected(new Set([draft.id]))
    setPicker(null)
    focusEditor()
  }, [onEdit])

  const onPick = useCallback((value: string) => {
    if (!picker) return
    const { draft, existing, step } = picker
    if (step === "team") return finishPicker({ ...draft, team: value as "VOID" | "OPP" }, existing)
    if (step === "out") return setPicker({ draft: { ...draft, playerId: value }, existing, step: "in" })
    if (step === "in") return finishPicker({ ...draft, playerInId: value }, existing)
    finishPicker({ ...draft, playerId: value }, existing)
  }, [picker, finishPicker])

  const cancelPicker = useCallback(() => {
    setPicker(null)
    focusEditor()
  }, [])

  const selectAndSeek = useCallback((ev: PointEventItem) => {
    setSelected(new Set([ev.id]))
    onSeek(offsets.get(ev.id) ?? 0)
  }, [offsets, onSeek])

  const stepSelection = useCallback((dir: 1 | -1) => {
    if (sortedEvents.length === 0) return
    const current = dir === 1
      ? [...sortedEvents].reverse().find(e => selected.has(e.id))
      : sortedEvents.find(e => selected.has(e.id))
    let idx: number
    if (current) {
      idx = sortedEvents.indexOf(current) + dir
    } else {
      const ph = getPlayheadMs()
      idx = dir === 1
        ? sortedEvents.findIndex(e => offsets.get(e.id)! > ph + 50)
        : sortedEvents.map(e => offsets.get(e.id)! < ph - 50).lastIndexOf(true)
      if (idx === -1) idx = dir === 1 ? sortedEvents.length - 1 : 0
    }
    selectAndSeek(sortedEvents[Math.min(sortedEvents.length - 1, Math.max(0, idx))])
  }, [sortedEvents, selected, offsets, getPlayheadMs, selectAndSeek])

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  const popoverOpen = !!picker || lineOpen
  const hk = { enabled: editable && !popoverOpen, preventDefault: true }
  // Keys that focused buttons/links also use only act as editor shortcuts when no control has focus
  const hkKeys = { enabled: () => editable && !popoverOpen && !controlHasFocus(), preventDefault: true }
  const hkNav = { enabled: !popoverOpen, preventDefault: true }
  const hkNavKeys = { enabled: () => !popoverOpen && !controlHasFocus(), preventDefault: true }

  useHotkeys(POINT_EVENT_TYPES.map(t => POINT_EVENT_META[t].hotkey), (e) => {
    const type = POINT_EVENT_TYPES.find(t => POINT_EVENT_META[t].hotkey === e.key.toLowerCase())
    if (type) addEvent(type)
  }, hk, [addEvent])

  useHotkeys("comma", () => shiftEvents(selected, -100), hk, [selected, shiftEvents])
  useHotkeys("period", () => shiftEvents(selected, 100), hk, [selected, shiftEvents])
  useHotkeys("shift+comma", () => shiftEvents(selected, -1000), hk, [selected, shiftEvents])
  useHotkeys("shift+period", () => shiftEvents(selected, 1000), hk, [selected, shiftEvents])

  // M: move selection to the playhead · Shift+M: slide the whole point so the anchor lands on the playhead
  useHotkeys("m", () => {
    const first = earliestSelected()
    if (first) shiftEvents(selected, Math.round(getPlayheadMs() - offsets.get(first.id)!))
  }, hk, [earliestSelected, selected, shiftEvents, getPlayheadMs, offsets])
  useHotkeys("shift+m", () => {
    const anchor = earliestSelected()
      ?? sortedEvents.find(e => e.eventType === "PULL_FINISHED")
      ?? sortedEvents[0]
    if (anchor) shiftEvents(sortedEvents.map(e => e.id), Math.round(getPlayheadMs() - offsets.get(anchor.id)!))
  }, hk, [earliestSelected, sortedEvents, shiftEvents, getPlayheadMs, offsets])

  useHotkeys(["backspace", "delete"], deleteSelected, hkKeys, [deleteSelected, popoverOpen, editable])
  useHotkeys("mod+z", undo, hk, [undo])
  useHotkeys(["mod+shift+z", "ctrl+y"], redo, hk, [redo])
  useHotkeys("mod+a", () => setSelected(new Set(events.map(e => e.id))), hk, [events])
  useHotkeys("escape", () => { setSelected(new Set()); setShowHelp(false) }, hkNav, [])
  useHotkeys("tab", () => stepSelection(1), hkNavKeys, [stepSelection, popoverOpen])
  useHotkeys("shift+tab", () => stepSelection(-1), hkNavKeys, [stepSelection, popoverOpen])
  useHotkeys("enter", () => {
    const only = selected.size === 1 ? events.find(e => selected.has(e.id)) : undefined
    if (only) editPlayers(only)
  }, hkKeys, [selected, events, editPlayers, popoverOpen, editable])
  useHotkeys("equal", () => zoomAround(0.67), hkNav, [zoomAround])
  useHotkeys("minus", () => zoomAround(1.5), hkNav, [zoomAround])
  useHotkeys("backslash", fitView, hkNav, [fitView])
  useHotkeys("shift+slash", () => setShowHelp(h => !h), hkNav, [])
  useHotkeys("shift+l", () => setLineOpen(true), hk, [])
  useHotkeys("e", () => onToggleEdit?.(), { enabled: !!onToggleEdit && !popoverOpen, preventDefault: true }, [onToggleEdit])

  const closeLine = useCallback(() => {
    setLineOpen(false)
    focusEditor()
  }, [])
  const saveLine = useCallback(async (ids: string[]) => {
    await onSaveLine(ids)
    closeLine()
  }, [onSaveLine, closeLine])
  const playerIdsWithEvents = useMemo(
    () => new Set(events.flatMap(e => [e.playerId, e.playerInId ?? ""]).filter(Boolean)),
    [events]
  )

  // ─── Pointer interactions ──────────────────────────────────────────────────

  const snapCandidates = useCallback((excludeIds: Set<string>) => {
    const c = [0, getPlayheadMs()]
    for (const ev of events) if (!excludeIds.has(ev.id)) c.push(offsets.get(ev.id)!)
    return c
  }, [events, offsets, getPlayheadMs])

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || popoverOpen) return
    rootRef.current?.focus()
    const x = localX(e.clientX)
    const y = localY(e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)

    if (y < RULER_H) {
      setInter({ kind: "scrub", pointerId: e.pointerId })
      onSeek(xToMs(x))
      return
    }

    const chipEl = (e.target as HTMLElement).closest<HTMLElement>("[data-ev]")
    const id = chipEl?.dataset.ev

    if (!editable) {
      setInter(null)
      const ev = id ? events.find(x => x.id === id) : undefined
      if (ev) selectAndSeek(ev)
      else { setSelected(new Set()); onSeek(xToMs(x)) }
      return
    }

    if (id && events.some(ev => ev.id === id)) {
      const additive = e.shiftKey
      const toggle = e.metaKey || e.ctrlKey
      let next = new Set(selected)
      if (toggle) { if (next.has(id)) next.delete(id); else next.add(id) }
      else if (additive) next.add(id)
      else if (!next.has(id)) next = new Set([id])
      setSelected(next)
      setInter({
        kind: "chips", pointerId: e.pointerId, originX: x, ids: next.has(id) ? [...next] : [],
        clickedId: id, plainClick: !additive && !toggle, moved: false, deltaMs: 0, snapMs: null,
      })
      return
    }

    setInter({
      kind: "marquee", pointerId: e.pointerId, x0: x, y0: y, x1: x, y1: y,
      additive: e.shiftKey || e.metaKey || e.ctrlKey, base: new Set(selected), moved: false,
    })
  }

  const lastScrubSeek = useRef(0)
  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const it = interactionRef.current
    if (!it || it.pointerId !== e.pointerId) return
    const x = localX(e.clientX)

    if (it.kind === "scrub") {
      // YouTube seeks are expensive — throttle while scrubbing
      const now = performance.now()
      if (now - lastScrubSeek.current > 80) { lastScrubSeek.current = now; onSeek(xToMs(x)) }
      return
    }

    if (it.kind === "chips") {
      if (it.ids.length === 0) return
      if (!it.moved && Math.abs(x - it.originX) < DRAG_THRESHOLD_PX) return
      let deltaMs = (x - it.originX) / (pxPerMs || 1)
      let snapMs: number | null = null
      if (snapEnabled && !e.altKey) {
        const cands = snapCandidates(new Set(it.ids))
        let best = SNAP_PX / (pxPerMs || 1)
        let correction = 0
        for (const id of it.ids) {
          const pos = (offsets.get(id) ?? 0) + deltaMs
          for (const c of cands) {
            const d = Math.abs(c - pos)
            if (d < best) { best = d; snapMs = c; correction = c - pos }
          }
        }
        deltaMs += correction
      }
      const clamped = clampDelta(it.ids, deltaMs)
      if (clamped !== deltaMs) { deltaMs = clamped; snapMs = 0 }
      setInter({ ...it, moved: true, deltaMs, snapMs })
      return
    }

    // Marquee
    const y = localY(e.clientY)
    const moved = it.moved || Math.abs(x - it.x0) > DRAG_THRESHOLD_PX || Math.abs(y - it.y0) > DRAG_THRESHOLD_PX
    if (!moved) return
    const left = Math.min(it.x0, x), right = Math.max(it.x0, x)
    const top = Math.min(it.y0, y), bottom = Math.max(it.y0, y)
    const next = new Set(it.additive ? it.base : [])
    for (const c of chips) {
      if (!c.ghost && c.x + c.w >= left && c.x <= right && c.y + CHIP_H >= top && c.y <= bottom) next.add(c.ev.id)
    }
    setSelected(next)
    setInter({ ...it, x1: x, y1: y, moved })
  }

  const onTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const it = interactionRef.current
    if (!it || it.pointerId !== e.pointerId) return
    setInter(null)
    if (it.kind === "scrub") { onSeek(xToMs(localX(e.clientX))); return }
    if (it.kind === "chips") {
      if (it.moved) {
        shiftEvents(it.ids, Math.round(it.deltaMs))
      } else if (it.plainClick) {
        const ev = events.find(x => x.id === it.clickedId)
        if (ev) selectAndSeek(ev)
      }
      return
    }
    // A plain click on empty track moves the playhead and clears the selection
    if (!it.moved) {
      if (!it.additive) setSelected(new Set())
      onSeek(xToMs(it.x0))
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const selectedEvents = sortedEvents.filter(e => selected.has(e.id))
  const single = selectedEvents.length === 1 ? selectedEvents[0] : null
  const pickerChip = picker ? chips.find(c => c.ev.id === picker.draft.id) : null
  const pickerMode: PickerMode | null = picker
    ? picker.step === "team"
      ? { kind: "team", title: "Timeout — team (V / O)" }
      : {
          kind: "player",
          title: picker.step === "out" ? "Sub — player out"
            : picker.step === "in" ? "Sub — player in"
            : `${POINT_EVENT_META[picker.draft.eventType].label} — player`,
          preferIds: picker.step === "in" ? [] : point.playerIds,
          excludeIds: picker.step === "in" ? [picker.draft.playerId] : [],
        }
    : null

  const incomplete = events.filter(e => !isEventComplete(e)).length

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={`relative flex flex-col rounded-xl border bg-black/40 focus:outline-none select-none transition-colors ${editable ? "border-amber-300/40" : "border-white/10"}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 border-b border-white/10 text-xs">
        {onCollapse && (
          <button type="button" onClick={onCollapse} title="Hide point timeline" aria-label="Hide point timeline" aria-expanded className="-ml-1 p-0.5 rounded text-white/40 hover:text-white hover:bg-white/10">
            <ChevronRight size={13} className="rotate-90" />
          </button>
        )}
        <span className="font-semibold text-white/80">Point {point.pointNumber}</span>
        <span className="text-white/40">{point.lineType}-line</span>
        <span className="font-mono text-white/40">{point.voidScoreBefore}–{point.opponentScoreBefore}</span>
        <span className="hidden sm:inline text-white/25">· {events.length} event{events.length === 1 ? "" : "s"}</span>
        <button
          type="button"
          onClick={editable ? () => setLineOpen(o => !o) : undefined}
          disabled={!editable}
          title={editable ? "Edit line (⇧L)" : "Line"}
          className={`flex items-center gap-1 min-w-0 px-1.5 py-0.5 rounded-md border transition-colors disabled:cursor-default ${lineOpen ? "border-white/30 bg-white/10" : editable ? "border-white/10 hover:border-white/25" : "border-transparent"}`}
        >
          <span className="text-white/40">Line</span>
          <span className={`font-mono truncate ${point.playerIds.length === 7 || !editable ? "text-white/70" : "text-amber-300"}`}>
            {point.playerIds.length === 0
              ? "—"
              : point.playerIds
                  .map(id => playerById.get(id)?.number)
                  .filter((n): n is number => n !== undefined)
                  .sort((a, b) => a - b)
                  .join(" ")}
          </span>
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          {editable && (
            <>
              <SaveIndicator status={saveStatus} error={saveError} incomplete={incomplete} onRetry={onRetrySave} />
              <span className="w-px h-4 bg-white/10 mx-1.5" />
              <IconButton label="Undo (⌘Z)" onClick={undo} disabled={!canUndo}><Undo2 size={14} /></IconButton>
              <IconButton label="Redo (⇧⌘Z)" onClick={redo} disabled={!canRedo}><Redo2 size={14} /></IconButton>
              <span className="w-px h-4 bg-white/10 mx-1.5" />
              <IconButton label={`Snapping ${snapEnabled ? "on" : "off"} (hold Alt to bypass)`} onClick={() => setSnapEnabled(s => !s)} active={snapEnabled}>
                <Magnet size={14} />
              </IconButton>
            </>
          )}
          <IconButton label="Zoom out (−)" onClick={() => zoomAround(1.5)}><ZoomOut size={14} /></IconButton>
          <IconButton label="Zoom in (=)" onClick={() => zoomAround(0.67)}><ZoomIn size={14} /></IconButton>
          <IconButton label="Fit point (\)" onClick={fitView}><Maximize2 size={13} /></IconButton>
          <IconButton label="Shortcuts (?)" onClick={() => setShowHelp(h => !h)} active={showHelp}><Keyboard size={14} /></IconButton>
          {onToggleEdit && (
            <button
              type="button"
              onClick={onToggleEdit}
              title={editable ? "Done editing (E)" : "Edit events (E)"}
              className={`ml-1.5 flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] transition-colors ${editable ? "border-amber-300/50 bg-amber-300/15 text-amber-200 hover:bg-amber-300/25" : "border-white/15 text-white/60 hover:text-white hover:border-white/30"}`}
            >
              {editable ? <Check size={12} /> : <Pencil size={11} />}
              {editable ? "Done" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {/* Tracks */}
      <div className="flex">
        <div className="shrink-0 border-r border-white/5" style={{ width: GUTTER }}>
          <div style={{ height: RULER_H }} />
          {LANES.map(l => (
            <div key={l.key} className="flex items-center px-2 text-[10px] uppercase tracking-wider text-white/30 border-t border-white/5" style={{ height: laneHeight(l.rows) }}>
              {l.label}
            </div>
          ))}
        </div>

        <div
          ref={trackRef}
          className="relative flex-1 min-w-0 overflow-hidden touch-none"
          style={{ height: TRACKS_HEIGHT, cursor: drag ? "grabbing" : "default" }}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={() => setInter(null)}
        >
          {/* Ruler */}
          <div className="absolute inset-x-0 top-0 cursor-ew-resize bg-white/[0.02] border-b border-white/10" style={{ height: RULER_H }}>
            {ticks.list.map(t => (
              <div key={t} className="absolute top-0 bottom-0" style={{ left: msToX(t) }}>
                <div className={`absolute bottom-0 w-px ${t === 0 ? "h-full bg-white/50" : "h-1.5 bg-white/20"}`} />
                <span className="absolute top-0.5 left-1 text-[9px] font-mono text-white/35 whitespace-nowrap">
                  {formatPointTime(t, ticks.step < 1000)}
                </span>
              </div>
            ))}
          </div>

          {/* Lane separators + gridlines */}
          {LANES.map((l, i) => (
            <div key={l.key} className="absolute inset-x-0 border-t border-white/5 pointer-events-none" style={{ top: LANE_TOPS[i], height: laneHeight(l.rows) }} />
          ))}
          {ticks.list.map(t => (
            <div key={`g${t}`} className={`absolute w-px pointer-events-none ${t === 0 ? "bg-white/20" : "bg-white/[0.04]"}`} style={{ left: msToX(t), top: RULER_H, bottom: 0 }} />
          ))}

          {/* Before the point starts — events can't go here */}
          {view.start < 0 && (
            <div
              className="absolute bottom-0 left-0 pointer-events-none bg-black/45 border-r border-white/20"
              style={{ top: RULER_H, width: Math.max(0, msToX(0)) }}
              title="Before the point starts"
            />
          )}

          {/* Snap guide */}
          {drag?.snapMs != null && (
            <div className="absolute top-0 bottom-0 w-px bg-amber-300/80 pointer-events-none z-20" style={{ left: msToX(drag.snapMs) }} />
          )}

          {/* Chips */}
          {chips.map(({ ev, x, y, w, label, ghost: isGhost }) => {
            const meta = POINT_EVENT_META[ev.eventType]
            const isSel = selected.has(ev.id)
            const complete = isEventComplete(ev)
            const detail = describe(ev)
            return (
              <div
                key={ev.id}
                data-ev={isGhost ? undefined : ev.id}
                onDoubleClick={isGhost || !editable ? undefined : () => editPlayers(ev)}
                title={`${meta.label}${detail ? ` · ${detail}` : ""} · ${formatPointTime(displayOffset(ev), true)}`}
                className={[
                  "absolute flex items-center gap-1 pr-1.5 rounded-md text-[10px] font-medium whitespace-nowrap overflow-hidden transition-[box-shadow,background-color] duration-75",
                  isGhost ? "border border-dashed border-white/50 bg-white/10 text-white/70"
                    : isSel ? `bg-white/25 text-white ring-1 ring-white/90 z-10 ${editable ? "cursor-grab" : "cursor-pointer"}`
                    : `bg-white/[0.08] text-white/80 hover:bg-white/15 ${editable ? "cursor-grab" : "cursor-pointer"}`,
                  !complete && !isGhost && editable ? "outline outline-1 outline-dashed outline-amber-300/70" : "",
                ].join(" ")}
                style={{ left: x, top: y, width: w, height: CHIP_H }}
              >
                <span className={`self-stretch w-[3px] shrink-0 ${meta.dot}`} />
                <span className="pl-0.5">{label}</span>
              </div>
            )
          })}

          {/* Marquee */}
          {interaction?.kind === "marquee" && interaction.moved && (
            <div
              className="absolute border border-sky-300/70 bg-sky-300/10 pointer-events-none z-20"
              style={{
                left: Math.min(interaction.x0, interaction.x1),
                top: Math.min(interaction.y0, interaction.y1),
                width: Math.abs(interaction.x1 - interaction.x0),
                height: Math.abs(interaction.y1 - interaction.y0),
              }}
            />
          )}

          {/* Drag delta readout */}
          {drag && (
            <div className="absolute top-0.5 right-2 z-30 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-white/80 pointer-events-none">
              {drag.deltaMs >= 0 ? "+" : "−"}{(Math.abs(drag.deltaMs) / 1000).toFixed(2)}s
            </div>
          )}

          {/* Playhead */}
          <div ref={playheadRef} className="absolute top-0 bottom-0 left-0 pointer-events-none z-30" style={{ opacity: 0 }}>
            <div className="absolute top-0 bottom-0 w-px bg-red-400" />
            <div className="absolute top-0 -translate-x-1/2 w-2.5 h-2.5 rotate-45 -mt-1.5 bg-red-400" />
            <span ref={playheadLabelRef} className="absolute top-0.5 left-1.5 text-[9px] font-mono text-red-300 bg-black/70 rounded px-0.5" />
          </div>

          {/* Player picker */}
          {picker && pickerMode && (
            <PlayerPicker
              mode={pickerMode}
              players={players}
              onPick={onPick}
              onCancel={cancelPicker}
              className="absolute z-40"
              style={{
                left: Math.min(Math.max(0, (pickerChip?.x ?? msToX(picker.draft.filmOffsetMs ?? 0)) - 16), Math.max(0, width - 256)),
                top: RULER_H + 4,
              }}
            />
          )}
        </div>
      </div>

      {/* Inspector / hints */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-white/10 min-h-[34px] text-[11px]">
        {!editable ? (
          single ? (
            <>
              <span className={POINT_EVENT_META[single.eventType].text}>{POINT_EVENT_META[single.eventType].label}</span>
              {describe(single) && <span className="text-white/70 truncate">{describe(single)}</span>}
              <span className="font-mono text-white/40">{formatPointTime(offsets.get(single.id) ?? 0, true)}</span>
              <span className="ml-auto text-white/30"><Kbd>Tab</Kbd> next event</span>
            </>
          ) : (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-white/30">
              Click an event to jump to it · <Kbd>Tab</Kbd><Kbd>⇧Tab</Kbd> step through events
              {onToggleEdit && <> · <Kbd>E</Kbd> edit</>}
            </span>
          )
        ) : single ? (
          <>
            <select
              value={single.eventType}
              onChange={e => changeType(single, e.target.value as PointEventType)}
              className={`bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-white/25 ${POINT_EVENT_META[single.eventType].text}`}
            >
              {POINT_EVENT_TYPES.map(t => <option key={t} value={t} className="bg-neutral-900 text-white">{POINT_EVENT_META[t].label}</option>)}
            </select>
            {pickerStepFor(single.eventType) && (
              <button
                onClick={() => editPlayers(single)}
                className={`truncate max-w-[220px] px-2 py-0.5 rounded-md border transition-colors ${isEventComplete(single) ? "border-white/10 text-white/70 hover:border-white/25" : "border-amber-300/50 text-amber-200 hover:border-amber-300"}`}
                title="Change (Enter)"
              >
                {describe(single) || "Set…"}
              </button>
            )}
            <span className="font-mono text-white/40">{formatPointTime(offsets.get(single.id) ?? 0, true)}</span>
            <span className="ml-auto flex items-center gap-2 text-white/30">
              <Kbd>,</Kbd><Kbd>.</Kbd> nudge <Kbd>M</Kbd> to playhead
              <button onClick={deleteSelected} className="ml-1 text-white/40 hover:text-red-400 transition-colors" aria-label="Delete event">
                <Trash2 size={13} />
              </button>
            </span>
          </>
        ) : selectedEvents.length > 1 ? (
          <>
            <span className="text-white/70">{selectedEvents.length} selected</span>
            <span className="flex items-center gap-2 text-white/30">
              drag or <Kbd>,</Kbd><Kbd>.</Kbd> to nudge · <Kbd>M</Kbd> to playhead · <Kbd>⌫</Kbd> delete
            </span>
            <button onClick={deleteSelected} className="ml-auto text-white/40 hover:text-red-400 transition-colors" aria-label="Delete selected events">
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-white/30">
            Add at playhead:
            {POINT_EVENT_TYPES.map(t => (
              <span key={t} className="flex items-center gap-1">
                <Kbd>{POINT_EVENT_META[t].hotkey.toUpperCase()}</Kbd>
                <span className={POINT_EVENT_META[t].text}>{POINT_EVENT_META[t].short}</span>
              </span>
            ))}
            <span className="text-white/20">·</span>
            <Kbd>⇧M</Kbd> sync point to playhead
          </span>
        )}
      </div>

      {iframeHasFocus && (
        <button
          onClick={reclaimFocus}
          className="absolute inset-x-0 bottom-0 z-50 py-1.5 rounded-b-xl bg-amber-400/15 border-t border-amber-300/30 text-[11px] text-amber-200 hover:bg-amber-400/25 transition-colors"
        >
          Shortcuts paused while the YouTube player has focus — click here to resume
        </button>
      )}

      {lineOpen && (
        <LineEditor
          initialIds={point.playerIds}
          players={players}
          playerIdsWithEvents={playerIdsWithEvents}
          onSave={saveLine}
          onCancel={closeLine}
          className="absolute left-2 top-10 z-50"
        />
      )}

      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
    </div>
  )
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function IconButton({ label, onClick, disabled, active, children }: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`p-1 rounded-md transition-colors disabled:opacity-25 disabled:cursor-default ${active ? "text-amber-300 bg-white/10" : "text-white/50 hover:text-white hover:bg-white/10"}`}
    >
      {children}
    </button>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded border border-white/15 bg-white/5 font-mono text-[9px] text-white/60">
      {children}
    </kbd>
  )
}

function SaveIndicator({ status, error, incomplete, onRetry }: {
  status: SaveStatus; error: string | null; incomplete: number; onRetry: () => void
}) {
  if (status === "error") {
    return (
      <button onClick={onRetry} title={error ?? undefined} className="flex items-center gap-1 text-red-300 hover:text-red-200 px-1">
        <AlertCircle size={13} /> Save failed · Retry
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1.5 px-1 text-white/40">
      {incomplete > 0 && <span className="text-amber-300/90">{incomplete} need{incomplete === 1 ? "s" : ""} a player ·</span>}
      {status === "saving" || status === "pending"
        ? <><Loader2 size={12} className="animate-spin" /> Saving</>
        : <><Check size={12} /> Saved</>}
    </span>
  )
}

const SHORTCUTS: [string, string][] = [
  ["Space / K", "Play / pause"],
  ["J / L", "Back / forward 5s"],
  ["← / →", "Back / forward 1s (⇧ for 0.1s)"],
  ["P F T B A G", "Add Pull · Pull finished · Turn · Block · Assist · Goal at playhead"],
  ["S / O", "Add Sub · Timeout at playhead"],
  ["Tab / ⇧Tab", "Select next / previous event and jump to it"],
  ["Click · ⇧Click · ⌘Click", "Select · add · toggle"],
  ["Drag empty track", "Box-select"],
  [", / .", "Nudge selection 0.1s (⇧ for 1s)"],
  ["M", "Move selection to playhead"],
  ["⇧M", "Slide the whole point so the selected event (or Pull finished) hits the playhead"],
  ["Enter / double-click", "Change player"],
  ["E", "Toggle edit mode (coaches)"],
  ["⇧L", "Edit the line for this point"],
  ["⌫", "Delete selection"],
  ["⌘A · Esc", "Select all · clear"],
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["= / − / \\ · ⌘scroll", "Zoom in / out / fit · zoom at cursor"],
  ["Alt while dragging", "Bypass snapping"],
  ["[ / ]", "Previous / next tagged point"],
]

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute right-2 top-10 z-50 w-[340px] rounded-xl border border-white/15 bg-neutral-950/95 backdrop-blur-sm shadow-2xl p-3">
      <div className="flex items-center mb-2">
        <span className="text-xs font-semibold text-white/80">Keyboard shortcuts</span>
        <button onClick={onClose} className="ml-auto text-white/40 hover:text-white text-xs">Esc</button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="contents">
            <span className="font-mono text-white/60 whitespace-nowrap">{k}</span>
            <span className="text-white/45">{d}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
