"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import {
  AlertCircle, Check, Link2, Loader2, Lock, Pause, Play, Redo2, Scissors, Trash2, Undo2, Unlock, X,
} from "lucide-react"
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer"
import { controlHasFocus } from "./PointEventEditor"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import {
  buildAngleCoverage, locateMain, mainMsOf, mainToAngle, type FilmSyncPoint, type MainTimeline,
} from "@/lib/film-tracks"

interface SyncEditorProps {
  trackName: string
  mainClips: FilmClipItem[]
  angleClips: FilmClipItem[]
  mainTimeline: MainTimeline
  durationMsOf: (clipId: string) => number | undefined
  /** Main film time to open both players at */
  startMainMs: number
  onSyncPointsChange: (clipId: string, points: FilmSyncPoint[]) => void
  onClose: () => void
}

type Side = "main" | "angle"
type PointsByClip = Record<string, FilmSyncPoint[]>
type SaveStatus = "saved" | "pending" | "saving" | "error"

const NO_POINTS: FilmSyncPoint[] = []
const FRAME_MS = 33
const SAVE_DEBOUNCE_MS = 600
const LOCK_TICK_MS = 250

function fmt(ms: number) {
  const abs = Math.max(0, ms)
  const m = Math.floor(abs / 60_000)
  const s = ((abs % 60_000) / 1000).toFixed(2).padStart(5, "0")
  return `${m}:${s}`
}

function fmtOffset(ms: number) {
  return `${ms < 0 ? "−" : "+"}${fmt(Math.abs(ms))}`
}

/** Side-by-side alignment of one camera angle against the main film */
export function SyncEditor({
  trackName, mainClips, angleClips, mainTimeline, durationMsOf, startMainMs, onSyncPointsChange, onClose,
}: SyncEditorProps) {
  // ─── Sync point document (undoable, autosaved per clip) ────────────────────
  const [points, setPoints] = useState<PointsByClip>(() =>
    Object.fromEntries(angleClips.map(c => [c.id, c.syncPoints ?? []]))
  )
  const [past, setPast] = useState<PointsByClip[]>([])
  const [future, setFuture] = useState<PointsByClip[]>([])
  const savedRef = useRef<PointsByClip>(points)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")

  // Synchronous mirror so edits/undo compute from the latest document without nested state updates
  const pointsRef = useRef(points)
  const commit = useCallback((clipId: string, next: FilmSyncPoint[]) => {
    const prev = pointsRef.current
    const updated = { ...prev, [clipId]: [...next].sort((a, b) => a.clipMs - b.clipMs) }
    pointsRef.current = updated
    setPast(p => [...p, prev].slice(-200))
    setFuture([])
    setPoints(updated)
  }, [])
  const undo = useCallback(() => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setPast(past.slice(0, -1))
    setFuture([pointsRef.current, ...future])
    pointsRef.current = prev
    setPoints(prev)
  }, [past, future])
  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    setFuture(future.slice(1))
    setPast([...past, pointsRef.current])
    pointsRef.current = next
    setPoints(next)
  }, [past, future])

  // Push local changes to the viewer immediately; persist each changed clip after a pause
  const onChangeRef = useRef(onSyncPointsChange)
  useEffect(() => { onChangeRef.current = onSyncPointsChange })
  const notifiedRef = useRef<PointsByClip>(points)
  useEffect(() => {
    for (const id of Object.keys(points)) {
      if (points[id] !== notifiedRef.current[id]) onChangeRef.current(id, points[id])
    }
    notifiedRef.current = points
    const dirty = Object.keys(points).filter(id => points[id] !== savedRef.current[id])
    if (dirty.length === 0) { setSaveStatus("saved"); return }
    setSaveStatus("pending")
    const timer = setTimeout(async () => {
      setSaveStatus("saving")
      try {
        for (const id of dirty) {
          const res = await fetch(`/api/film/clips/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ syncPoints: points[id] }),
          })
          if (!res.ok) throw new Error("Save failed")
          savedRef.current = { ...savedRef.current, [id]: points[id] }
        }
        setSaveStatus("saved")
      } catch {
        setSaveStatus("error")
      }
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [points])

  // ─── Players ───────────────────────────────────────────────────────────────
  const coverage = useMemo(
    () => buildAngleCoverage(angleClips.map(c => ({ ...c, syncPoints: points[c.id] ?? [] })), mainTimeline, durationMsOf),
    [angleClips, points, mainTimeline, durationMsOf]
  )

  const initial = useMemo(() => {
    const loc = locateMain(mainTimeline, startMainMs)
    const hit = mainToAngle(startMainMs, coverage)
    return {
      mainIdx: loc?.idx ?? 0,
      mainMs: loc?.clipMs ?? 0,
      angleIdx: hit ? Math.max(0, angleClips.findIndex(c => c.id === hit.clipId)) : 0,
      angleMs: hit?.clipMs ?? 0,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [mainIdx, setMainIdx] = useState(initial.mainIdx)
  const [angleIdx, setAngleIdx] = useState(initial.angleIdx)
  const mainClip = mainClips[mainIdx]
  const angleClip = angleClips[angleIdx]

  const players = { main: useRef<YouTubePlayerHandle>(null), angle: useRef<YouTubePlayerHandle>(null) }
  const ready = useRef({ main: false, angle: false })
  const pending = useRef<{ main: number | null; angle: number | null }>({ main: initial.mainMs, angle: initial.angleMs })
  const playingRef = useRef({ main: false, angle: false })
  const [playing, setPlaying] = useState({ main: false, angle: false })
  const posRef = useRef({ main: initial.mainMs, angle: initial.angleMs })
  const [pos, setPos] = useState(posRef.current)
  const [measured, setMeasured] = useState<Record<string, number>>({})
  const [focus, setFocus] = useState<Side>("angle")
  const [locked, setLocked] = useState(false)
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const durationOf = (clip?: FilmClipItem) =>
    clip ? (durationMsOf(clip.id) ?? measured[clip.id] ?? 0) : 0

  const seekSide = useCallback((side: Side, ms: number) => {
    const clamped = Math.max(0, ms)
    posRef.current = { ...posRef.current, [side]: clamped }
    const p = players[side].current
    if (ready.current[side] && p) p.currentTime = clamped / 1000
    else pending.current[side] = clamped
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadClip = useCallback((side: Side, idx: number, ms: number) => {
    ready.current[side] = false
    pending.current[side] = Math.max(0, ms)
    posRef.current = { ...posRef.current, [side]: Math.max(0, ms) }
    if (side === "main") setMainIdx(idx)
    else setAngleIdx(idx)
  }, [])

  const togglePlay = useCallback((side: Side) => {
    const p = players[side].current
    if (!p || !ready.current[side]) return
    if (playingRef.current[side]) p.pause()
    else p.play()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canPlayHandler = (side: Side) => () => {
    const p = players[side].current
    if (!p) return
    if (side === "angle") p.muted = true
    if (pending.current[side] !== null) {
      p.currentTime = pending.current[side]! / 1000
      pending.current[side] = null
    }
    ready.current[side] = true
  }

  // Track positions for readouts (DOM-free RAF → 10Hz state)
  useEffect(() => {
    let raf: number
    let last = 0
    const tick = () => {
      for (const side of ["main", "angle"] as Side[]) {
        const p = players[side].current
        if (p && ready.current[side] && pending.current[side] === null) {
          posRef.current = { ...posRef.current, [side]: p.currentTime * 1000 }
        }
      }
      const now = performance.now()
      if (now - last > 100) { last = now; setPos(posRef.current) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Locked preview: the angle follows main through the current alignment
  const lockState = useRef({ coverage, mainIdx, angleIdx })
  useEffect(() => { lockState.current = { coverage, mainIdx, angleIdx } })
  useEffect(() => {
    if (!locked) return
    const id = setInterval(() => {
      const { coverage, mainIdx, angleIdx } = lockState.current
      const mainMs = mainMsOf(mainTimeline, mainClips[mainIdx]?.id ?? "", posRef.current.main)
      const hit = mainMs === null ? null : mainToAngle(mainMs, coverage, angleClips[angleIdx]?.id)
      const angle = players.angle.current
      if (!hit) { if (playingRef.current.angle) angle?.pause(); return }
      const targetIdx = angleClips.findIndex(c => c.id === hit.clipId)
      if (targetIdx !== angleIdx) { loadClip("angle", targetIdx, hit.clipMs); return }
      if (!angle || !ready.current.angle) return
      const drift = Math.abs(posRef.current.angle - hit.clipMs)
      if (drift > (playingRef.current.main ? 350 : 60)) angle.currentTime = hit.clipMs / 1000
      if (playingRef.current.main && !playingRef.current.angle) angle.play()
      if (!playingRef.current.main && playingRef.current.angle) angle.pause()
    }, LOCK_TICK_MS)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked])

  // ─── Edits ─────────────────────────────────────────────────────────────────
  const angleClipId = angleClip?.id
  const clipPoints = useMemo(() => (angleClipId ? points[angleClipId] : undefined) ?? NO_POINTS, [points, angleClipId])

  const addSync = useCallback(() => {
    if (!angleClip || !mainClip) return
    const point: FilmSyncPoint = {
      id: crypto.randomUUID(), kind: "sync",
      clipMs: Math.round(posRef.current.angle),
      mainClipId: mainClip.id, mainClipMs: Math.round(posRef.current.main),
    }
    commit(angleClip.id, [...clipPoints, point])
    setSelectedPointId(point.id)
  }, [angleClip, mainClip, clipPoints, commit])

  const addDesync = useCallback(() => {
    if (!angleClip) return
    const point: FilmSyncPoint = { id: crypto.randomUUID(), kind: "desync", clipMs: Math.round(posRef.current.angle) }
    commit(angleClip.id, [...clipPoints, point])
    setSelectedPointId(point.id)
  }, [angleClip, clipPoints, commit])

  const deletePoint = useCallback((id: string | null) => {
    if (!angleClip || !id) return
    commit(angleClip.id, clipPoints.filter(p => p.id !== id))
    setSelectedPointId(null)
  }, [angleClip, clipPoints, commit])

  const jumpToPoint = useCallback((p: FilmSyncPoint) => {
    setSelectedPointId(p.id)
    seekSide("angle", p.clipMs)
    if (p.kind === "sync") {
      const idx = mainClips.findIndex(c => c.id === p.mainClipId)
      if (idx === mainIdx) seekSide("main", p.mainClipMs)
      else if (idx !== -1) loadClip("main", idx, p.mainClipMs)
    }
  }, [mainClips, mainIdx, seekSide, loadClip])

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  const hk = { preventDefault: true }
  const hkKeys = { enabled: () => !controlHasFocus(), preventDefault: true }
  const nudge = (ms: number) => {
    if (locked && focus === "angle") return
    seekSide(focus, posRef.current[focus] + ms)
  }
  useHotkeys("tab", () => setFocus(f => f === "main" ? "angle" : "main"), hkKeys, [])
  useHotkeys("space", () => togglePlay(locked ? "main" : focus), hkKeys, [focus, locked, togglePlay])
  useHotkeys("shift+space", () => { togglePlay("main"); if (!locked) togglePlay("angle") }, hkKeys, [locked, togglePlay])
  useHotkeys("arrowleft", () => nudge(-1000), hk, [focus, locked])
  useHotkeys("arrowright", () => nudge(1000), hk, [focus, locked])
  useHotkeys("shift+arrowleft", () => nudge(-100), hk, [focus, locked])
  useHotkeys("shift+arrowright", () => nudge(100), hk, [focus, locked])
  useHotkeys("comma", () => nudge(-FRAME_MS), hk, [focus, locked])
  useHotkeys("period", () => nudge(FRAME_MS), hk, [focus, locked])
  useHotkeys("j", () => nudge(-5000), hk, [focus, locked])
  useHotkeys("l", () => nudge(5000), hk, [focus, locked])
  useHotkeys("enter", addSync, hkKeys, [addSync])
  useHotkeys("d", addDesync, hk, [addDesync])
  useHotkeys(["backspace", "delete"], () => deletePoint(selectedPointId), hkKeys, [deletePoint, selectedPointId])
  useHotkeys("mod+z", undo, hk, [undo])
  useHotkeys(["mod+shift+z", "ctrl+y"], redo, hk, [redo])
  useHotkeys("p", () => setLocked(l => !l), hk, [])
  useHotkeys("escape", onClose, hk, [onClose])

  // ─── Render helpers ────────────────────────────────────────────────────────
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()   // buttons don't steal keyboard focus
  const angleDuration = durationOf(angleClip)
  const clipCoverage = coverage.filter(s => s.clipId === angleClip?.id)
  const currentMainMs = mainClip ? mainMsOf(mainTimeline, mainClip.id, pos.main) : null
  const currentOffset = currentMainMs !== null ? currentMainMs - pos.angle : null

  const renderSide = (side: Side) => {
    const isMain = side === "main"
    const clip = isMain ? mainClip : angleClip
    const clipsList = isMain ? mainClips : angleClips
    const idx = isMain ? mainIdx : angleIdx
    const duration = durationOf(clip)
    const focused = focus === side
    const disabled = locked && !isMain
    return (
      <div
        className={`flex flex-col gap-2 rounded-xl border p-2 transition-colors ${focused ? "border-warning/50 bg-amber-300/[0.03]" : "border-border"}`}
        onMouseDown={() => setFocus(side)}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className={`font-semibold ${focused ? "text-warning" : "text-fg-secondary"}`}>{isMain ? "Main" : trackName}</span>
          <select
            value={idx}
            disabled={disabled}
            onChange={e => { loadClip(side, Number(e.target.value), 0); e.currentTarget.blur() }}
            className="min-w-0 flex-1 bg-surface border border-border rounded-md px-1.5 py-0.5 text-[11px] text-foreground disabled:opacity-50"
          >
            {clipsList.map((c, i) => <option key={c.id} value={i} className="bg-card">{c.title ?? `Clip ${i + 1}`}</option>)}
          </select>
          {disabled && <span className="flex items-center gap-1 text-[11px] text-brand-text"><Lock size={10} /> following Main</span>}
        </div>
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
          {clip && (
            <YouTubePlayer
              ref={players[side]}
              videoId={clip.youtubeVideoId}
              className="absolute inset-0"
              onCanPlay={canPlayHandler(side)}
              onPlay={() => { playingRef.current[side] = true; setPlaying(p => ({ ...p, [side]: true })) }}
              onPause={() => { playingRef.current[side] = false; setPlaying(p => ({ ...p, [side]: false })) }}
              onEnd={() => { playingRef.current[side] = false; setPlaying(p => ({ ...p, [side]: false })) }}
              onDurationChange={(d, videoId) => {
                if (videoId === clip.youtubeVideoId) setMeasured(m => m[clip.id] ? m : { ...m, [clip.id]: d * 1000 })
              }}
            />
          )}
          {/* Click to focus + play/pause; bottom strip left open for YouTube's controls (quality gear) */}
          <button
            type="button"
            aria-label={`Play or pause ${isMain ? "Main" : trackName}`}
            onMouseDown={keepFocus}
            onClick={() => { setFocus(side); if (!disabled) togglePlay(side) }}
            className="absolute inset-x-0 top-0 bottom-12 cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => togglePlay(side)}
            disabled={disabled}
            className="text-fg-secondary hover:text-foreground disabled:opacity-30"
            aria-label={playing[side] ? "Pause" : "Play"}
          >
            {playing[side] ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={10}
            value={Math.min(pos[side], Math.max(1, duration))}
            disabled={disabled || duration === 0}
            onChange={e => seekSide(side, Number(e.target.value))}
            onMouseUp={e => e.currentTarget.blur()}
            className="flex-1 accent-amber-300 disabled:opacity-40"
            aria-label={`${isMain ? "Main" : trackName} position`}
          />
          <span className="font-mono text-[11px] text-fg-secondary tabular-nums w-[64px] text-right">{fmt(pos[side])}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          {[-1000, -100, -FRAME_MS, FRAME_MS, 100, 1000].map(d => (
            <button
              key={d}
              type="button"
              onMouseDown={keepFocus}
              disabled={disabled}
              onClick={() => { setFocus(side); seekSide(side, posRef.current[side] + d) }}
              className="px-1.5 py-0.5 rounded-md font-mono text-fg-muted hover:text-foreground hover:bg-surface-2 disabled:opacity-30"
            >
              {d > 0 ? "+" : "−"}{Math.abs(d) === FRAME_MS ? "1f" : Math.abs(d) >= 1000 ? "1s" : ".1s"}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 select-none">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs">
        <Link2 size={14} className="text-warning" />
        <span className="font-semibold text-foreground">Sync {trackName} to Main</span>
        <span className="text-fg-muted hidden md:inline">Find the same moment in both (a pull release is ideal), then press Enter.</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="flex items-center gap-1 px-1 text-fg-muted">
            {saveStatus === "error" ? <><AlertCircle size={12} className="text-destructive" /><span className="text-destructive">Save failed</span></>
              : saveStatus === "saved" ? <><Check size={12} /> Saved</>
              : <><Loader2 size={12} className="animate-spin" /> Saving</>}
          </span>
          <button type="button" onMouseDown={keepFocus} onClick={undo} disabled={past.length === 0} className="p-1 rounded-md text-fg-muted hover:text-foreground hover:bg-surface-2 disabled:opacity-25" aria-label="Undo"><Undo2 size={14} /></button>
          <button type="button" onMouseDown={keepFocus} onClick={redo} disabled={future.length === 0} className="p-1 rounded-md text-fg-muted hover:text-foreground hover:bg-surface-2 disabled:opacity-25" aria-label="Redo"><Redo2 size={14} /></button>
          <button type="button" onMouseDown={keepFocus} onClick={onClose} className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-border text-fg-secondary hover:text-foreground hover:border-border-strong" aria-label="Close sync editor">
            <X size={12} /> Done
          </button>
        </div>
      </div>

      {/* Players */}
      <div className="grid md:grid-cols-2 gap-3">
        {renderSide("main")}
        {renderSide("angle")}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onMouseDown={keepFocus} onClick={addSync} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-warning/20 border border-warning/40 text-warning hover:bg-warning/30">
          <Link2 size={13} /> Sync here <kbd className="font-mono text-[11px] text-warning/70">↵</kbd>
        </button>
        <button type="button" onMouseDown={keepFocus} onClick={addDesync} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-fg-secondary hover:text-foreground hover:border-border-strong">
          <Scissors size={13} /> Desync at {trackName} playhead <kbd className="font-mono text-[11px] text-fg-muted">D</kbd>
        </button>
        <button type="button" onMouseDown={keepFocus} onClick={() => setLocked(l => !l)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border ${locked ? "border-brand/50 bg-brand/15 text-brand-text" : "border-border text-fg-secondary hover:text-foreground hover:border-border-strong"}`}>
          {locked ? <Lock size={13} /> : <Unlock size={13} />} Preview alignment <kbd className="font-mono text-[11px] text-fg-muted">P</kbd>
        </button>
        <span className="ml-auto font-mono text-[11px] text-fg-muted">
          current offset {currentOffset !== null ? fmtOffset(currentOffset) : "—"}
        </span>
      </div>

      {/* Coverage strip for the current angle clip */}
      {angleClip && angleDuration > 0 && (
        <div className="flex flex-col gap-1">
          <div
            className="relative h-5 rounded-md bg-surface overflow-hidden cursor-pointer"
            onMouseDown={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              setFocus("angle")
              if (!locked) seekSide("angle", ((e.clientX - rect.left) / rect.width) * angleDuration)
            }}
          >
            {clipCoverage.map(s => (
              <div
                key={`${s.clipStartMs}`}
                className="absolute top-0 bottom-0 bg-success/25 border-x border-success/40"
                style={{ left: `${(s.clipStartMs / angleDuration) * 100}%`, width: `${((Math.min(s.clipEndMs, angleDuration) - s.clipStartMs) / angleDuration) * 100}%` }}
                title={`Synced: ${fmt(s.clipStartMs)}–${fmt(Math.min(s.clipEndMs, angleDuration))} → Main ${fmt(s.mainStartMs)}`}
              />
            ))}
            {clipPoints.map(p => (
              <div
                key={p.id}
                className={`absolute top-0 bottom-0 w-0.5 ${p.kind === "sync" ? "bg-success" : "bg-destructive"} ${p.id === selectedPointId ? "ring-2 ring-white/70" : ""}`}
                style={{ left: `${(p.clipMs / angleDuration) * 100}%` }}
              />
            ))}
            <div className="absolute top-0 bottom-0 w-px bg-warning" style={{ left: `${(pos.angle / angleDuration) * 100}%` }} />
          </div>
          <div className="flex gap-3 text-[11px] text-fg-muted">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-md bg-success/40" /> synced footage</span>
            <span className="flex items-center gap-1"><span className="w-0.5 h-2 bg-success" /> sync</span>
            <span className="flex items-center gap-1"><span className="w-0.5 h-2 bg-destructive" /> desync (camera stopped)</span>
            <span>Unshaded stretches show &ldquo;no footage&rdquo; when viewing this angle.</span>
          </div>
        </div>
      )}

      {/* Points for this clip */}
      <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
        {clipPoints.length === 0 ? (
          <p className="text-xs text-fg-muted py-2">
            No sync points on this clip yet. Line up a moment visible from both cameras and press Enter.
          </p>
        ) : clipPoints.map(p => {
          const mainMs = p.kind === "sync" ? mainMsOf(mainTimeline, p.mainClipId, p.mainClipMs) : null
          const selected = p.id === selectedPointId
          return (
            <div
              key={p.id}
              onClick={() => jumpToPoint(p)}
              className={`group flex items-center gap-3 px-2 py-1 rounded-md text-xs cursor-pointer ${selected ? "bg-surface-2" : "hover:bg-surface-2"}`}
            >
              {p.kind === "sync"
                ? <span className="flex items-center gap-1 w-16 text-success"><Link2 size={11} /> Sync</span>
                : <span className="flex items-center gap-1 w-16 text-destructive"><Scissors size={11} /> Desync</span>}
              <span className="font-mono text-fg-secondary">{trackName} {fmt(p.clipMs)}</span>
              {p.kind === "sync" && (
                <>
                  <span className="text-fg-faint">↔</span>
                  <span className="font-mono text-fg-secondary">{mainMs !== null ? `Main ${fmt(mainMs)}` : "Main clip removed"}</span>
                  {mainMs !== null && <span className="font-mono text-fg-muted">{fmtOffset(mainMs - p.clipMs)}</span>}
                </>
              )}
              <button
                type="button"
                onMouseDown={keepFocus}
                onClick={e => { e.stopPropagation(); deletePoint(p.id) }}
                className="ml-auto text-fg-muted hover:text-destructive opacity-0 group-hover:opacity-100"
                aria-label="Delete point"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-fg-faint">
        <kbd className="font-mono">Tab</kbd> switch side · <kbd className="font-mono">Space</kbd> play/pause focused (<kbd className="font-mono">⇧Space</kbd> both) ·
        {" "}<kbd className="font-mono">← →</kbd> 1s (<kbd className="font-mono">⇧</kbd> 0.1s) · <kbd className="font-mono">, .</kbd> one frame · <kbd className="font-mono">J L</kbd> 5s ·
        {" "}<kbd className="font-mono">⌫</kbd> delete selected · <kbd className="font-mono">⌘Z</kbd> undo · <kbd className="font-mono">Esc</kbd> done
      </p>
    </div>
  )
}
