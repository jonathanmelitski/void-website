"use client"

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, ChevronRight,
  Columns2, Link2, PanelRightClose, PanelRightOpen, VideoOff,
} from "lucide-react"
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer"
import { PointEventEditor, controlHasFocus } from "./PointEventEditor"
import { AnnotationMarker } from "./AnnotationMarker"
import { FollowerPlayer } from "./FollowerPlayer"
import { SyncEditor } from "./SyncEditor"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"
import type { FilmAnnotationMessage } from "@/lib/ws-push"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem } from "@/lib/aws/point-events"
import { POINT_EVENT_META } from "@/lib/point-event-meta"
import { authorLabel } from "@/lib/author-name"
import { useFilmPointEvents, resolveOffsets } from "@/hooks/use-film-point-events"
import type { PlayerItem } from "@/lib/aws/players"
import {
  MAIN_TRACK_ID, angleToMain, buildAngleCoverage, buildMainTimeline, locateMain, mainToAngle, nextCoverage, trackIdOf,
  type CoverageSpan, type FilmSyncPoint, type FilmTrack,
} from "@/lib/film-tracks"

interface FilmViewerProps {
  /** All of the game's clips: main track (no trackId) plus any camera angles */
  clips: FilmClipItem[]
  initialAnnotations: FilmAnnotationItem[]
  canAnnotate: boolean
  /** Open the sync editor for this angle on load (from Manage → Film) */
  initialSyncTrackId?: string
}

type PointEntry = {
  kind: "point"
  point: PointItem
  markerAnn: FilmAnnotationItem | null
  textAnns: FilmAnnotationItem[]
}
type OtherEntry = { kind: "other"; ann: FilmAnnotationItem }
type SidebarEntry = PointEntry | OtherEntry

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${m}:${ss.toString().padStart(2, "0")}`
}

const POINT_COLORS: Record<string, string> = {
  "O-HOLD": "bg-blue-500",
  "O-BREAK": "bg-orange-500",
  "D-HOLD": "bg-green-500",
  "D-BREAK": "bg-red-500",
}

function getPointColor(lineType: string, outcome: string) {
  return POINT_COLORS[`${lineType}-${outcome}`] ?? "bg-white/20"
}

const NO_EVENTS: PointEventItem[] = []

/** One disclosure style for every collapsible section: chevron + section name (+ what's inside) */
function SectionToggle({ open, label, detail, onClick }: { open: boolean; label: string; detail?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="self-start flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/35 hover:text-white/70 transition-colors"
    >
      <ChevronRight size={11} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      {label}
      {detail && <span className="normal-case tracking-normal text-white/25">· {detail}</span>}
      <span className="normal-case tracking-normal text-white/25">— {open ? "hide" : "show"}</span>
    </button>
  )
}

// Per-viewer layout conveniences (collapsed sections), remembered in this browser only
type LayoutPrefs = { lanes: boolean; editor: boolean; sidebar: boolean }
const LAYOUT_KEY = "void-film-viewer-layout"
const DEFAULT_LAYOUT: LayoutPrefs = { lanes: true, editor: true, sidebar: true }
function readLayoutPrefs(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    return raw ? { ...DEFAULT_LAYOUT, ...JSON.parse(raw) } : DEFAULT_LAYOUT
  } catch {
    return DEFAULT_LAYOUT
  }
}
// The video always keeps at least this share of the window height, even if controls then need a scroll
const MIN_VIDEO_VIEWPORT_SHARE = 0.5
// Fullscreen overlay fades this long after the last key press once the mouse leaves it
const OVERLAY_IDLE_MS = 2500

/** Width cap that keeps 16:9 video at or under maxH tall (two players side by side, or stacked when narrow) */
function videoAreaMaxWidth(fit: { maxH: number; wide: boolean }, split: boolean) {
  const GAP = 8
  if (!split) return fit.maxH * 16 / 9
  return fit.wide ? 2 * (fit.maxH * 16 / 9) + GAP : ((fit.maxH - GAP) / 2) * 16 / 9
}

function suggestNextScore(points: PointItem[]): { voidScore: number; oppScore: number } {
  if (points.length === 0) return { voidScore: 0, oppScore: 0 }
  const last = [...points].sort((a, b) => b.pointNumber - a.pointNumber)[0]
  if (last.outcome === "IN_PROGRESS") return { voidScore: last.voidScoreBefore, oppScore: last.opponentScoreBefore }
  const voidScored =
    (last.outcome === "HOLD" && last.lineType === "O") ||
    (last.outcome === "BREAK" && last.lineType === "D")
  return {
    voidScore: last.voidScoreBefore + (voidScored ? 1 : 0),
    oppScore: last.opponentScoreBefore + (voidScored ? 0 : 1),
  }
}


export function FilmViewer({ clips: clipsProp, initialAnnotations, canAnnotate, initialSyncTrackId }: FilmViewerProps) {
  // Local copy so sync edits show immediately; adopts a new clips prop when the parent passes one
  const [allClips, setAllClips] = useState(clipsProp)
  const [seenClipsProp, setSeenClipsProp] = useState(clipsProp)
  if (seenClipsProp !== clipsProp) { setSeenClipsProp(clipsProp); setAllClips(clipsProp) }
  // The main track defines game film time; everything below that says "clips" means main clips
  const clips = useMemo(() => allClips.filter(c => trackIdOf(c) === MAIN_TRACK_ID), [allClips])

  const playerRef = useRef<YouTubePlayerHandle>(null)
  const isPlayingRef = useRef(false)
  const activeClipIdxRef = useRef(0)
  const pendingSeekRef = useRef<number | null>(null)
  const lastDisplayUpdateRef = useRef(0)

  const currentMsRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)
  const playheadRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const timecodeRef = useRef<HTMLSpanElement>(null)
  const hoverLineRef = useRef<HTMLDivElement>(null)
  const hoverTooltipRef = useRef<HTMLSpanElement>(null)
  // True while a programmatic clip change is in-flight — prevents onPause from clearing isPlayingRef
  const transitioningRef = useRef(false)
  // Mirror memos into refs so the RAF loop can read the latest values without a stale closure
  const clipOffsetsRef = useRef<number[]>([])
  const totalDurationMsRef = useRef(0)

  const [activeClipIdx, setActiveClipIdx] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Fullscreen: controls float over the video and fade out while playing
  const [overlayHovered, setOverlayHovered] = useState(false)
  const [overlayRecentKey, setOverlayRecentKey] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const [isPaused, setIsPaused] = useState(true)
  const [isMuted, setIsMuted] = useState(false)
  // Main film time shown in labels (updated ~4Hz by the RAF loop)
  const [displayMainMs, setDisplayMainMs] = useState(0)
  const [playerError, setPlayerError] = useState<string | null>(null)
  // Durations measured by the player for clips whose record has none yet (backfilled to the DB once)
  const [measuredDurations, setMeasuredDurations] = useState<Record<string, number>>({})

  // Camera angle being watched. On an angle, activeClipIdx still tracks the main clip at the current game moment.
  const [activeTrackId, setActiveTrackId] = useState<string>(MAIN_TRACK_ID)
  const [angleClipId, setAngleClipId] = useState<string | null>(null)
  // Set when the chosen angle has no footage at this game moment (holds the main time we're "at")
  const [noCoverageMainMs, setNoCoverageMainMs] = useState<number | null>(null)
  // Angle footage is playing but this stretch isn't synced to main
  const [angleUnsynced, setAngleUnsynced] = useState(false)
  const [splitTrackId, setSplitTrackId] = useState<string | null>(null)
  const [syncTrackId, setSyncTrackId] = useState<string | null>(initialSyncTrackId ?? null)

  const activeClip = clips[activeClipIdx]
  const angleClip = activeTrackId !== MAIN_TRACK_ID && angleClipId
    ? allClips.find(c => c.id === angleClipId) ?? null
    : null
  // With no angle footage loaded (no coverage), the main video stays loaded under the overlay
  const playingClip = angleClip ?? activeClip
  const activeSrc = playingClip?.youtubeVideoId ?? ""

  // Keep activeClipIdxRef in sync before paint so the RAF never reads a stale value
  useLayoutEffect(() => { activeClipIdxRef.current = activeClipIdx }, [activeClipIdx])

  // Reset display state whenever the active src changes (clip switch or clips prop reorder)
  useEffect(() => {
    if (!transitioningRef.current) setIsPaused(true)
    currentMsRef.current = 0
    setPlayerReady(false)
    setPlayerError(null)
  }, [activeSrc])

  // Clip durations come from the stored clip record — never updated dynamically.
  // The boundary line is computed once from these and never moves during playback.
  // A clip imported without a duration falls back to the player's one-time measurement.
  const clipDurationsMs = useMemo(
    () => clips.map(c => (c.durationSeconds ?? measuredDurations[c.id] ?? 0) * 1000),
    [clips, measuredDurations]
  )
  const clipOffsets = useMemo(() => {
    const result: number[] = []
    let acc = 0
    for (const dur of clipDurationsMs) { result.push(acc); acc += dur }
    return result
  }, [clipDurationsMs])
  const totalDurationMs = useMemo(() => clipDurationsMs.reduce((a, b) => a + b, 0), [clipDurationsMs])
  const globalMs = displayMainMs

  // Keep offset/duration refs in sync before paint so the RAF reads fresh values on every frame
  useLayoutEffect(() => { clipOffsetsRef.current = clipOffsets }, [clipOffsets])
  useLayoutEffect(() => { totalDurationMsRef.current = totalDurationMs }, [totalDurationMs])

  // ─── Camera angles ────────────────────────────────────────────────────────
  const mainTimeline = useMemo(() => buildMainTimeline(clips.map(c => c.id), clipDurationsMs), [clips, clipDurationsMs])
  const durationMsOf = useCallback((clipId: string) => {
    const c = allClips.find(x => x.id === clipId)
    const sec = c?.durationSeconds ?? measuredDurations[clipId]
    return sec ? sec * 1000 : undefined
  }, [allClips, measuredDurations])
  const [filmTracks, setFilmTracks] = useState<FilmTrack[]>([])
  const angleTracks = useMemo((): FilmTrack[] => {
    const withClips = [...new Set(allClips.map(trackIdOf).filter(id => id !== MAIN_TRACK_ID))]
    const named = filmTracks.filter(t => withClips.includes(t.id))
    const unnamed = withClips
      .filter(id => !filmTracks.some(t => t.id === id))
      .map((id, i) => ({ id, name: `Angle ${named.length + i + 1}` }))
    return [...named, ...unnamed]
  }, [allClips, filmTracks])
  const allTracks = useMemo(() => [{ id: MAIN_TRACK_ID, name: "Main" }, ...angleTracks], [angleTracks])
  const trackName = useCallback((id: string) => allTracks.find(t => t.id === id)?.name ?? "Angle", [allTracks])
  const angleClipsByTrack = useMemo(() => {
    const map = new Map<string, FilmClipItem[]>()
    for (const c of allClips) {
      const t = trackIdOf(c)
      if (t === MAIN_TRACK_ID) continue
      map.set(t, [...(map.get(t) ?? []), c])
    }
    return map
  }, [allClips])
  const coverageByTrack = useMemo(() => {
    const map = new Map<string, CoverageSpan[]>()
    // Main as a "track" maps onto itself — lets split view follow Main from an angle
    map.set(MAIN_TRACK_ID, clips.map((c, i) => ({
      clipId: c.id, clipStartMs: 0, clipEndMs: clipDurationsMs[i] || Infinity, offsetMs: clipOffsets[i],
      mainStartMs: clipOffsets[i], mainEndMs: clipOffsets[i] + (clipDurationsMs[i] || Infinity),
    })))
    for (const t of angleTracks) map.set(t.id, buildAngleCoverage(angleClipsByTrack.get(t.id) ?? [], mainTimeline, durationMsOf))
    return map
  }, [clips, clipDurationsMs, clipOffsets, angleTracks, angleClipsByTrack, mainTimeline, durationMsOf])

  // Refs mirrored for the RAF loop and stable callbacks
  const clipsRef = useRef(clips)
  useLayoutEffect(() => { clipsRef.current = clips }, [clips])
  const mainTimelineRef = useRef(mainTimeline)
  useLayoutEffect(() => { mainTimelineRef.current = mainTimeline }, [mainTimeline])
  const coverageByTrackRef = useRef(coverageByTrack)
  useLayoutEffect(() => { coverageByTrackRef.current = coverageByTrack }, [coverageByTrack])
  const angleClipsByTrackRef = useRef(angleClipsByTrack)
  useLayoutEffect(() => { angleClipsByTrackRef.current = angleClipsByTrack }, [angleClipsByTrack])
  const playbackRef = useRef({ trackId: activeTrackId, angleClipId, noCoverageMainMs })
  useLayoutEffect(() => { playbackRef.current = { trackId: activeTrackId, angleClipId, noCoverageMainMs } }, [activeTrackId, angleClipId, noCoverageMainMs])
  const playingClipRef = useRef(playingClip)
  useLayoutEffect(() => { playingClipRef.current = playingClip }, [playingClip])
  const lastMainMsRef = useRef(0)

  /** Main film time at the playhead; null while playing unsynced angle footage */
  const getMainMsNow = useCallback((): number | null => {
    const pb = playbackRef.current
    if (pb.trackId === MAIN_TRACK_ID) return (clipOffsetsRef.current[activeClipIdxRef.current] ?? 0) + currentMsRef.current
    if (pb.noCoverageMainMs !== null) return pb.noCoverageMainMs
    if (transitioningRef.current || !pb.angleClipId) return lastMainMsRef.current
    return angleToMain(pb.angleClipId, currentMsRef.current, coverageByTrackRef.current.get(pb.trackId) ?? [])
  }, [])
  const getMainMsOrLast = useCallback(() => getMainMsNow() ?? lastMainMsRef.current, [getMainMsNow])
  /** Where the playhead lands on the main track — notes, point tags and events are anchored here */
  const mainAnchorNow = useCallback(() => {
    const mainMs = getMainMsNow()
    if (mainMs === null) return null
    const loc = locateMain(mainTimelineRef.current, mainMs)
    return loc ? { clip: clipsRef.current[loc.idx], clipMs: Math.round(loc.clipMs) } : null
  }, [getMainMsNow])

  const [annotations, setAnnotations] = useState<FilmAnnotationItem[]>(initialAnnotations)
  const [newText, setNewText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [points, setPoints] = useState<PointItem[]>([])
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [activePointId, setActivePointId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [layout, setLayout] = useState<LayoutPrefs>(readLayoutPrefs)
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* storage unavailable */ }
  }, [layout])
  const updateLayout = useCallback((patch: Partial<LayoutPrefs>) => setLayout(prev => ({ ...prev, ...patch })), [])

  // The page can't see mouse movement over the YouTube iframe, so in fullscreen any key press
  // reveals the overlay for a moment (alongside hovering the strip just above YouTube's bar)
  useEffect(() => {
    if (!isFullscreen) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onKey = () => {
      setOverlayRecentKey(true)
      clearTimeout(timer)
      timer = setTimeout(() => setOverlayRecentKey(false), OVERLAY_IDLE_MS)
    }
    window.addEventListener("keydown", onKey)
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer) }
  }, [isFullscreen])

  // Size the video so it plus the controls/editor below it fit the window: never cropped, never taller than the screen
  const [videoFit, setVideoFit] = useState<{ maxH: number; wide: boolean } | null>(null)
  const chromeElRef = useRef<HTMLDivElement | null>(null)
  const chromeObserverRef = useRef<ResizeObserver | null>(null)
  const measureVideoFit = useCallback(() => {
    const chromeH = chromeElRef.current?.getBoundingClientRect().height ?? 0
    const vh = window.innerHeight
    const maxH = Math.round(Math.max(vh * MIN_VIDEO_VIEWPORT_SHARE, vh - chromeH - 24))
    const wide = window.matchMedia("(min-width: 768px)").matches
    setVideoFit(prev => prev && prev.maxH === maxH && prev.wide === wide ? prev : { maxH, wide })
  }, [])
  const chromeRef = useCallback((el: HTMLDivElement | null) => {
    chromeObserverRef.current?.disconnect()
    chromeElRef.current = el
    if (!el) return
    const ro = new ResizeObserver(measureVideoFit)
    ro.observe(el)
    chromeObserverRef.current = ro
  }, [measureVideoFit])
  useEffect(() => {
    window.addEventListener("resize", measureVideoFit)
    return () => window.removeEventListener("resize", measureVideoFit)
  }, [measureVideoFit])
  const [expandedPointIds, setExpandedPointIds] = useState<Set<string>>(new Set())
  // Explicitly choosing a point pauses playhead-following briefly so the seek can land first
  const followHoldUntilRef = useRef(0)
  const choosePoint = useCallback((id: string | null) => {
    followHoldUntilRef.current = performance.now() + 1200
    setActivePointId(id)
  }, [])

  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)
  const [showPointPicker, setShowPointPicker] = useState(false)

  const [showNewPointForm, setShowNewPointForm] = useState(false)
  const [npNumber, setNpNumber] = useState(1)
  const [npVoid, setNpVoid] = useState(0)
  const [npOpp, setNpOpp] = useState(0)
  const [npLine, setNpLine] = useState<"O" | "D">("O")
  const [npOutcome, setNpOutcome] = useState<"HOLD" | "BREAK" | "—">("—")
  const [showPlayerPicker, setShowPlayerPicker] = useState(false)
  const [npPlayerIds, setNpPlayerIds] = useState<string[]>([])
  const [creatingPoint, setCreatingPoint] = useState(false)

  const gameId = activeClip?.gameId ?? ""
  const pointEventsDoc = useFilmPointEvents(gameId)

  useEffect(() => {
    if (!gameId) return
    fetch(`/api/points?gameId=${gameId}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: PointItem[]) => {
        if (Array.isArray(data)) setPoints(data.sort((a, b) => a.pointNumber - b.pointNumber))
      })
      .catch(() => {})
    fetch(`/api/games/${gameId}`)
      .then(r => r.ok ? r.json() : null)
      .then((game: { filmTracks?: FilmTrack[] } | null) => setFilmTracks(game?.filmTracks ?? []))
      .catch(() => {})
    fetch("/api/players")
      .then(r => r.ok ? r.json() : [])
      .then((data: PlayerItem[]) => { if (Array.isArray(data)) setPlayers(data) })
      .catch(() => {})
  }, [gameId])

  const markerMap = useMemo(() => {
    const map = new Map<string, FilmAnnotationItem>()
    for (const ann of annotations) {
      if (ann.pointId && !map.has(ann.pointId)) map.set(ann.pointId, ann)
    }
    for (const ann of annotations) {
      if (ann.pointId && !ann.text) map.set(ann.pointId, ann)
    }
    return map
  }, [annotations])

  const getGlobalMs = useCallback((ann: FilmAnnotationItem): number => {
    const clipIdx = clips.findIndex(c => c.id === ann.clipId)
    return clipIdx >= 0 ? (clipOffsets[clipIdx] ?? 0) + ann.videoTimestampMs : ann.videoTimestampMs
  }, [clips, clipOffsets])

  const globalAnnotations = useMemo(() =>
    annotations.map(ann => ({ ...ann, videoTimestampMs: getGlobalMs(ann) })),
    [annotations, getGlobalMs]
  )

  const globalMetaSegments = useMemo(() => {
    const markers = [...points]
      .map(point => {
        const markerAnn = markerMap.get(point.id)
        if (!markerAnn) return null
        const clipIdx = clips.findIndex(c => c.id === markerAnn.clipId)
        if (clipIdx < 0) return null
        return { point, markerAnn, globalStart: (clipOffsets[clipIdx] ?? 0) + markerAnn.videoTimestampMs }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.globalStart - b.globalStart)
    return markers.map((m, i) => ({
      ...m,
      segEnd: markers[i + 1]?.globalStart ?? totalDurationMs,
    }))
  }, [points, markerMap, clips, clipOffsets, totalDurationMs])

  // Each film-tagged point's events on the global timeline: marker time + the event's point-relative
  // offset (edited in the point editor, or derived from live-recorded spacing until then)
  const eventsByPoint = useMemo(() => {
    const map = new Map<string, PointEventItem[]>()
    for (const ev of pointEventsDoc.events) {
      const list = map.get(ev.pointId) ?? []
      list.push(ev)
      map.set(ev.pointId, list)
    }
    return map
  }, [pointEventsDoc.events])

  const globalEventMarks = useMemo(() => {
    const marks: { event: PointEventItem; point: PointItem; globalMs: number }[] = []
    for (const point of points) {
      const markerAnn = markerMap.get(point.id)
      const events = eventsByPoint.get(point.id)
      if (!markerAnn || !events) continue
      const offsets = resolveOffsets(events)
      const base = getGlobalMs(markerAnn)
      for (const ev of events) marks.push({ event: ev, point, globalMs: base + offsets.get(ev.id)! })
    }
    return marks
  }, [points, markerMap, eventsByPoint, getGlobalMs])

  const playerLabel = useCallback((id: string | undefined) => {
    if (!id) return ""
    const p = players.find(pl => pl.id === id)
    return p ? `#${p.number} ${p.first_name}` : ""
  }, [players])

  const describeEvent = useCallback((ev: PointEventItem) => {
    if (ev.eventType === "TIMEOUT") return ev.team === "OPP" ? "Opponent" : "Void"
    if (ev.eventType === "SUBSTITUTION") return `${playerLabel(ev.playerId)} → ${playerLabel(ev.playerInId)}`
    return playerLabel(ev.playerId)
  }, [playerLabel])

  const activeKeepRange = useMemo((): [number, number] | null => {
    const seg = globalMetaSegments.find(sg => sg.point.id === activePointId)
    if (!seg) return null
    const offs = [...resolveOffsets(eventsByPoint.get(seg.point.id) ?? []).values()]
    return [
      seg.globalStart + Math.min(0, ...offs) - 1500,
      Math.max(seg.segEnd, ...offs.map(o => seg.globalStart + o + 500)),
    ]
  }, [globalMetaSegments, activePointId, eventsByPoint])
  const activeKeepRangeRef = useRef(activeKeepRange)
  useLayoutEffect(() => { activeKeepRangeRef.current = activeKeepRange }, [activeKeepRange])

  const segmentsRef = useRef(globalMetaSegments)
  useLayoutEffect(() => { segmentsRef.current = globalMetaSegments }, [globalMetaSegments])
  const activePointIdRef = useRef(activePointId)
  useLayoutEffect(() => { activePointIdRef.current = activePointId }, [activePointId])
  const sidebarEntries = useMemo((): SidebarEntry[] => {
    const sortedPoints = [...points].sort((a, b) => a.pointNumber - b.pointNumber)
    const pointEntries: SidebarEntry[] = sortedPoints.map(point => {
      const allPointAnns = annotations
        .filter(a => a.pointId === point.id)
        .sort((a, b) => getGlobalMs(a) - getGlobalMs(b))
      const markerAnn = markerMap.get(point.id) ?? null
      const textAnns = allPointAnns.filter(a => a.text)
      return { kind: "point", point, markerAnn, textAnns }
    })
    const otherEntries: SidebarEntry[] = annotations
      .filter(a => !a.pointId)
      .sort((a, b) => getGlobalMs(a) - getGlobalMs(b))
      .map(ann => ({ kind: "other" as const, ann }))
    return [...pointEntries, ...otherEntries]
  }, [points, annotations, markerMap, getGlobalMs])

  const seekMainTrack = useCallback((targetMs: number) => {
    let remaining = Math.max(0, targetMs)
    for (let i = 0; i < clips.length; i++) {
      const dur = clipDurationsMs[i]
      if (remaining < dur || i === clips.length - 1) {
        const startSec = remaining / 1000
        if (i !== activeClipIdx) {
          transitioningRef.current = true
          pendingSeekRef.current = startSec
          setActiveClipIdx(i)
        } else if (transitioningRef.current) {
          // Clip is buffering — update the pending seek so handleCanPlay uses this position
          pendingSeekRef.current = startSec
        } else {
          if (playerRef.current) playerRef.current.currentTime = startSec
        }
        break
      }
      remaining -= dur
    }
  }, [clips, clipDurationsMs, activeClipIdx])

  const seekAngle = useCallback((trackId: string, targetMs: number) => {
    const target = Math.max(0, targetMs)
    const hit = mainToAngle(target, coverageByTrack.get(trackId) ?? [], angleClipId ?? undefined)
    lastMainMsRef.current = target
    if (!hit) {
      setNoCoverageMainMs(target)
      setDisplayMainMs(target)
      playerRef.current?.pause()
      return
    }
    setNoCoverageMainMs(null)
    const sec = hit.clipMs / 1000
    const targetClip = allClips.find(c => c.id === hit.clipId)
    const sameVideo = targetClip?.youtubeVideoId === playingClipRef.current?.youtubeVideoId
    if (hit.clipId !== angleClipId && !sameVideo) {
      transitioningRef.current = true
      pendingSeekRef.current = sec
      setAngleClipId(hit.clipId)
    } else {
      if (hit.clipId !== angleClipId) setAngleClipId(hit.clipId)
      if (transitioningRef.current) pendingSeekRef.current = sec
      else if (playerRef.current) playerRef.current.currentTime = sec
    }
  }, [coverageByTrack, angleClipId, allClips])

  /** Seek to a main film time on whichever angle is being watched */
  const seekGlobal = useCallback((targetMs: number) => {
    if (activeTrackId === MAIN_TRACK_ID) seekMainTrack(targetMs)
    else seekAngle(activeTrackId, targetMs)
  }, [activeTrackId, seekMainTrack, seekAngle])

  /** Switch camera angle, staying on the same game moment (or `atMainMs`) */
  const switchTrack = useCallback((trackId: string, atMainMs?: number) => {
    const target = Math.max(0, atMainMs ?? getMainMsOrLast())
    lastMainMsRef.current = target
    setDisplayMainMs(target)
    if (trackId === MAIN_TRACK_ID) {
      const loc = locateMain(mainTimeline, target)
      setActiveTrackId(MAIN_TRACK_ID)
      setAngleClipId(null)
      setNoCoverageMainMs(null)
      setAngleUnsynced(false)
      if (!loc) return
      const sameVideo = clips[loc.idx]?.youtubeVideoId === playingClipRef.current?.youtubeVideoId
      if (sameVideo && !transitioningRef.current) {
        if (playerRef.current) playerRef.current.currentTime = loc.clipMs / 1000
      } else {
        transitioningRef.current = true
        pendingSeekRef.current = loc.clipMs / 1000
      }
      setActiveClipIdx(loc.idx)
      return
    }
    setActiveTrackId(trackId)
    setAngleUnsynced(false)
    const hit = mainToAngle(target, coverageByTrack.get(trackId) ?? [])
    if (!hit) {
      setNoCoverageMainMs(target)
      playerRef.current?.pause()
      return
    }
    setNoCoverageMainMs(null)
    const targetClip = allClips.find(c => c.id === hit.clipId)
    if (targetClip?.youtubeVideoId === playingClipRef.current?.youtubeVideoId && !transitioningRef.current) {
      if (playerRef.current) playerRef.current.currentTime = hit.clipMs / 1000
    } else {
      transitioningRef.current = true
      pendingSeekRef.current = hit.clipMs / 1000
    }
    setAngleClipId(hit.clipId)
  }, [getMainMsOrLast, mainTimeline, clips, coverageByTrack, allClips])

  // ─── Point event editor (the active, film-tagged point) ───────────────────
  const editorPoint = activePointId ? points.find(p => p.id === activePointId) ?? null : null
  const editorMarker = editorPoint ? markerMap.get(editorPoint.id) ?? null : null
  const editorMarkerGlobalMs = editorMarker ? getGlobalMs(editorMarker) : 0
  const editorMarkerGlobalRef = useRef(0)
  useLayoutEffect(() => { editorMarkerGlobalRef.current = editorMarkerGlobalMs }, [editorMarkerGlobalMs])
  const editorPointId = editorPoint?.id

  const editorRangeMs = useMemo((): [number, number] => {
    const seg = globalMetaSegments.find(sg => sg.point.id === editorPointId)
    const len = seg ? seg.segEnd - seg.globalStart : 0
    return [-2000, Math.max(15_000, len + 1000)]
  }, [globalMetaSegments, editorPointId])

  const getEditorPlayheadMs = useCallback(
    () => getMainMsOrLast() - editorMarkerGlobalRef.current,
    [getMainMsOrLast]
  )
  const seekEditor = useCallback((pointMs: number) => seekGlobal(editorMarkerGlobalRef.current + pointMs), [seekGlobal])
  const { editPoint } = pointEventsDoc
  const editEditorPoint = useCallback((fn: (pointEvents: PointEventItem[]) => PointEventItem[]) => {
    if (editorPointId) editPoint(editorPointId, fn)
  }, [editorPointId, editPoint])

  const toggleEditMode = useCallback(() => setEditMode(m => !m), [])

  const saveEditorLine = useCallback(async (playerIds: string[]) => {
    if (!editorPointId) return
    const res = await fetch(`/api/points/${editorPointId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerIds }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error ?? "Failed to save line")
    }
    const updated: PointItem = await res.json()
    setPoints(prev => prev.map(p => p.id === updated.id ? updated : p))
  }, [editorPointId])

  // Playback keys (editing keys live in the editor)
  const seekRelative = useCallback((deltaMs: number) => {
    seekGlobal(Math.max(0, getMainMsOrLast() + deltaMs))
  }, [seekGlobal, getMainMsOrLast])
  const syncOpen = syncTrackId !== null
  const playKeys = { enabled: !syncOpen, preventDefault: true }
  const togglePlayback = () => {
    if (!playerReady || noCoverageMainMs !== null) return
    if (isPaused) playerRef.current?.play()
    else playerRef.current?.pause()
  }
  useHotkeys("k", togglePlayback, playKeys, [playerReady, isPaused, noCoverageMainMs])
  useHotkeys("space", togglePlayback, { enabled: () => !syncOpen && !controlHasFocus(), preventDefault: true }, [playerReady, isPaused, noCoverageMainMs, syncOpen])
  useHotkeys("j", () => seekRelative(-5000), playKeys, [seekRelative])
  useHotkeys("l", () => seekRelative(5000), playKeys, [seekRelative])
  useHotkeys("arrowleft", () => seekRelative(-1000), playKeys, [seekRelative])
  useHotkeys("arrowright", () => seekRelative(1000), playKeys, [seekRelative])
  useHotkeys("shift+arrowleft", () => seekRelative(-100), playKeys, [seekRelative])
  useHotkeys("shift+arrowright", () => seekRelative(100), playKeys, [seekRelative])
  // 1 = Main, 2–9 = angles; V toggles split view
  useHotkeys(["1", "2", "3", "4", "5", "6", "7", "8", "9"], e => {
    const track = allTracks[Number(e.key) - 1]
    if (track && allTracks.length > 1) switchTrack(track.id)
  }, playKeys, [allTracks, switchTrack])
  useHotkeys("v", () => {
    if (allTracks.length < 2) return
    setSplitTrackId(cur => cur ? null : (allTracks.find(t => t.id !== activeTrackId)?.id ?? null))
  }, playKeys, [allTracks, activeTrackId])

  const openNewPointForm = useCallback((pts: PointItem[]) => {
    const { voidScore, oppScore } = suggestNextScore(pts)
    const maxNum = pts.reduce((m, p) => Math.max(m, p.pointNumber), 0)
    setNpNumber(maxNum + 1)
    setNpVoid(voidScore)
    setNpOpp(oppScore)
    setNpLine("O")
    setNpOutcome("—")
    setNpPlayerIds([])
    setShowPlayerPicker(false)
    setShowNewPointForm(true)
  }, [])

  const jumpToAnnotation = useCallback((ann: FilmAnnotationItem) => {
    choosePoint(ann.pointId ?? null)
    if (!clips.some(c => c.id === ann.clipId)) return
    seekGlobal(getGlobalMs(ann))
  }, [clips, choosePoint, seekGlobal, getGlobalMs])

  const jumpToClip = useCallback((idx: number) => {
    if (activeTrackId !== MAIN_TRACK_ID) { seekGlobal(clipOffsets[idx] ?? 0); return }
    if (idx === activeClipIdx) {
      if (playerRef.current) playerRef.current.currentTime = 0
      return
    }
    transitioningRef.current = true
    pendingSeekRef.current = 0
    setActiveClipIdx(idx)
  }, [activeClipIdx, activeTrackId, seekGlobal, clipOffsets])

  const addPointTag = useCallback(async (point: PointItem) => {
    const anchor = mainAnchorNow()
    if (!anchor) return
    const res = await fetch("/api/film/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clipId: anchor.clip.id,
        videoTimestampMs: anchor.clipMs,
        text: "",
        pointId: point.id,
      }),
    })
    if (res.ok) {
      const annotation: FilmAnnotationItem = await res.json()
      setAnnotations(prev => [...prev, annotation])
      choosePoint(point.id)
    }
  }, [mainAnchorNow, choosePoint])

  // RAF loop — smooth 60fps playhead + timecode, bypasses React render cycle.
  // Reads all changing values from refs so it never restarts on clip switch (no stale-closure flash).
  useEffect(() => {
    let rafId: number
    const tick = () => {
      if (!isDraggingRef.current && playerRef.current) {
        try {
          // During a clip transition the player still has the previous clip's src loaded.
          // Use 0 so the playhead shows the start of the incoming clip, not the old end position.
          const ct = transitioningRef.current ? 0 : playerRef.current.currentTime * 1000
          currentMsRef.current = ct
          const total = totalDurationMsRef.current
          const onAngle = playbackRef.current.trackId !== MAIN_TRACK_ID
          const mainNow = getMainMsNow()
          if (mainNow !== null) lastMainMsRef.current = mainNow
          const gms = mainNow ?? lastMainMsRef.current
          if (total > 0) {
            const pct = Math.min(100, Math.max(0, (gms / total) * 100))
            if (playheadRef.current) playheadRef.current.style.left = `${pct}%`
            if (progressRef.current) progressRef.current.style.width = `${pct}%`
            if (timecodeRef.current) timecodeRef.current.textContent = `${formatTime(gms)} / ${formatTime(total)}`
          }
          // Throttle React state update to ~4Hz to avoid excess re-renders
          const now = Date.now()
          if (now - lastDisplayUpdateRef.current > 250) {
            lastDisplayUpdateRef.current = now
            setDisplayMainMs(gms)
            setAngleUnsynced(onAngle && mainNow === null)
            // On an angle, keep activeClipIdx on the main clip at this game moment (clip pills, note channel)
            if (onAngle && mainNow !== null && playbackRef.current.angleClipId) {
              const loc = locateMain(mainTimelineRef.current, mainNow)
              if (loc && loc.idx !== activeClipIdxRef.current) setActiveClipIdx(loc.idx)
            }
            // The timeline follows the point under the playhead (playing or scrubbing). The active
            // point holds while the playhead is near its own events so edge edits don't flip points.
            const range = activeKeepRangeRef.current
            const holding = performance.now() < followHoldUntilRef.current || transitioningRef.current
            if (!holding && (!range || gms < range[0] || gms > range[1])) {
              const seg = segmentsRef.current.find(sg => gms >= sg.globalStart && gms < sg.segEnd)
              if (seg && seg.point.id !== activePointIdRef.current) {
                activePointIdRef.current = seg.point.id
                setActivePointId(seg.point.id)
              }
            }
          }
        } catch {
          // Player not ready yet — skip
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // empty — everything is read from refs kept in sync by useLayoutEffect

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [])

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    isDraggingRef.current = true
    if (hoverLineRef.current) hoverLineRef.current.style.opacity = "0"

    const getMs = (clientX: number) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect || totalDurationMs === 0) return 0
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * totalDurationMs
    }
    const updateVisual = (clientX: number) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect || totalDurationMs === 0) return
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
      if (playheadRef.current) playheadRef.current.style.left = `${pct}%`
      if (progressRef.current) progressRef.current.style.width = `${pct}%`
      if (timecodeRef.current) timecodeRef.current.textContent = `${formatTime((pct / 100) * totalDurationMs)} / ${formatTime(totalDurationMs)}`
    }
    updateVisual(e.clientX)

    const onMove = (ev: MouseEvent) => updateVisual(ev.clientX)
    const onUp = (ev: MouseEvent) => {
      isDraggingRef.current = false
      if (hoverLineRef.current) hoverLineRef.current.style.opacity = "1"
      seekGlobal(getMs(ev.clientX))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [seekGlobal, totalDurationMs])

  const handleTimelineMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingRef.current || !timelineRef.current || totalDurationMs === 0) return
    const rect = timelineRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    if (hoverLineRef.current) hoverLineRef.current.style.left = `${pct}%`
    if (hoverTooltipRef.current) {
      const ms = (pct / 100) * totalDurationMs
      const seg = segmentsRef.current.find(sg => ms >= sg.globalStart && ms < sg.segEnd)
      hoverTooltipRef.current.textContent = seg ? `P${seg.point.pointNumber} · ${formatTime(ms)}` : formatTime(ms)
    }
  }, [totalDurationMs])

  const handleTimelineMouseEnter = useCallback(() => {
    if (totalDurationMs > 0 && hoverLineRef.current) hoverLineRef.current.style.opacity = "1"
  }, [totalDurationMs])

  const handleTimelineMouseLeave = useCallback(() => {
    if (hoverLineRef.current) hoverLineRef.current.style.opacity = "0"
  }, [])

  const handleTimelineTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault()
    isDraggingRef.current = true
    const getMs = (clientX: number) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect || totalDurationMs === 0) return 0
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * totalDurationMs
    }
    const updateVisual = (clientX: number) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect || totalDurationMs === 0) return
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
      if (playheadRef.current) playheadRef.current.style.left = `${pct}%`
      if (progressRef.current) progressRef.current.style.width = `${pct}%`
      if (timecodeRef.current) timecodeRef.current.textContent = `${formatTime((pct / 100) * totalDurationMs)} / ${formatTime(totalDurationMs)}`
    }
    updateVisual(e.touches[0].clientX)
    const onMove = (ev: TouchEvent) => updateVisual(ev.touches[0].clientX)
    const onEnd = (ev: TouchEvent) => {
      isDraggingRef.current = false
      seekGlobal(getMs(ev.changedTouches[0].clientX))
      document.removeEventListener("touchmove", onMove)
      document.removeEventListener("touchend", onEnd)
    }
    document.addEventListener("touchmove", onMove, { passive: false })
    document.addEventListener("touchend", onEnd)
  }, [seekGlobal, totalDurationMs])

  const wsRef = useRef<WebSocket | null>(null)
  const unmountedRef = useRef(false)
  const attemptsRef = useRef(0)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clipId = activeClip?.id

  const connect = useCallback(() => {
    if (unmountedRef.current || attemptsRef.current >= 3 || !clipId) return
    try {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:"
      const wsHost = process.env.NEXT_PUBLIC_WS_HOST ?? location.host
      const ws = new WebSocket(`${protocol}//${wsHost}/ws/film/${clipId}`)
      wsRef.current = ws
      ws.onopen = () => { attemptsRef.current = 0 }
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data) as FilmAnnotationMessage
          setAnnotations(prev => {
            if (msg.type === "ANNOTATION_CREATED") {
              if (prev.some(a => a.id === msg.annotation.id)) return prev
              return [...prev, msg.annotation]
            }
            if (msg.type === "ANNOTATION_UPDATED") {
              return prev.map(a => a.id === msg.annotation.id ? msg.annotation : a)
            }
            if (msg.type === "ANNOTATION_DELETED") {
              return prev.filter(a => a.id !== msg.annotation.id)
            }
            return prev
          })
        } catch { /* ignore */ }
      }
      ws.onclose = e => {
        wsRef.current = null
        if (e.code === 1000 || unmountedRef.current) return
        const delay = Math.min(1_000 * Math.pow(2, attemptsRef.current++), 30_000)
        reconnectRef.current = setTimeout(connect, delay)
      }
      ws.onerror = () => ws.close()
    } catch { attemptsRef.current++ }
  }, [clipId])

  useEffect(() => {
    unmountedRef.current = false
    attemptsRef.current = 0
    connect()
    return () => {
      unmountedRef.current = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close(1000)
      wsRef.current = null
    }
  }, [connect])

  // [ / ] keyboard navigation through tagged points
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (syncTrackId !== null) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key !== "[" && e.key !== "]") return
      const navigable = [...points]
        .sort((a, b) => a.pointNumber - b.pointNumber)
        .filter(p => markerMap.has(p.id))
      const currentIdx = activePointId
        ? navigable.findIndex(p => p.id === activePointId)
        : -1
      if (e.key === "[" && currentIdx > 0) {
        jumpToAnnotation(markerMap.get(navigable[currentIdx - 1].id)!)
      } else if (e.key === "]") {
        if (currentIdx === -1 && navigable.length > 0) {
          jumpToAnnotation(markerMap.get(navigable[0].id)!)
        } else if (currentIdx >= 0 && currentIdx < navigable.length - 1) {
          jumpToAnnotation(markerMap.get(navigable[currentIdx + 1].id)!)
        }
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [points, markerMap, activePointId, jumpToAnnotation, syncTrackId])

  // Vidstack event handlers
  const handleError = useCallback((message: string) => {
    transitioningRef.current = false
    setPlayerError(message)
    setPlayerReady(false)
    isPlayingRef.current = false
    setIsPaused(true)
  }, [])

  const handleCanPlay = useCallback(() => {
    transitioningRef.current = false
    setPlayerReady(true)
    setPlayerError(null)
    if (pendingSeekRef.current !== null && playerRef.current) {
      playerRef.current.currentTime = pendingSeekRef.current
      pendingSeekRef.current = null
    }
    if (isPlayingRef.current) playerRef.current?.play()
  }, [])

  const handleDurationChange = useCallback((duration: number, videoId: string) => {
    const clip = playingClipRef.current
    if (!clip || clip.durationSeconds || !Number.isFinite(duration) || duration <= 0) return
    // Ignore a late report for the previous video during a clip switch
    if (videoId !== clip.youtubeVideoId) return
    setMeasuredDurations(prev => {
      if (prev[clip.id]) return prev
      if (canAnnotate) {
        fetch(`/api/film/clips/${clip.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ durationSeconds: duration }),
        }).catch(() => {})
      }
      return { ...prev, [clip.id]: duration }
    })
  }, [canAnnotate])

  const handleEnd = useCallback(() => {
    const pb = playbackRef.current
    if (pb.trackId !== MAIN_TRACK_ID) {
      // Continue into this angle's next upload
      const trackClips = angleClipsByTrackRef.current.get(pb.trackId) ?? []
      const next = trackClips[trackClips.findIndex(c => c.id === pb.angleClipId) + 1]
      if (next && pb.angleClipId) {
        isPlayingRef.current = true
        transitioningRef.current = true
        pendingSeekRef.current = 0
        setAngleClipId(next.id)
      } else {
        isPlayingRef.current = false
        setIsPaused(true)
      }
      return
    }
    const nextIdx = activeClipIdxRef.current + 1
    const hasNext = nextIdx < clips.length
    if (hasNext) {
      // onPause fires before onEnd — restore isPlayingRef so handleCanPlay auto-plays the next clip
      isPlayingRef.current = true
      transitioningRef.current = true
      pendingSeekRef.current = 0
      setActiveClipIdx(nextIdx)
    } else {
      isPlayingRef.current = false
      setIsPaused(true)
    }
  }, [clips])

  const createAndTagPoint = useCallback(async () => {
    const anchor = mainAnchorNow()
    if (creatingPoint || !activeClip || !anchor) return
    setCreatingPoint(true)
    try {
      const pointRes = await fetch("/api/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: activeClip.gameId,
          pointNumber: npNumber,
          voidScoreBefore: npVoid,
          opponentScoreBefore: npOpp,
          lineType: npLine,
          ...(npOutcome !== "—" ? { outcome: npOutcome } : {}),
          playerIds: npPlayerIds,
        }),
      })
      if (!pointRes.ok) return
      const point: PointItem = await pointRes.json()

      const annRes = await fetch("/api/film/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: anchor.clip.id,
          videoTimestampMs: anchor.clipMs,
          text: "",
          pointId: point.id,
        }),
      })
      if (annRes.ok) {
        const annotation: FilmAnnotationItem = await annRes.json()
        setAnnotations(prev => [...prev, annotation])
        choosePoint(point.id)
      }

      setPoints(prev => [...prev, point].sort((a, b) => a.pointNumber - b.pointNumber))
      setShowNewPointForm(false)
    } finally {
      setCreatingPoint(false)
    }
  }, [activeClip, mainAnchorNow, creatingPoint, npNumber, npVoid, npOpp, npLine, npOutcome, npPlayerIds, choosePoint])

  const addAnnotation = useCallback(async () => {
    const trimmed = newText.trim()
    const anchor = mainAnchorNow()
    if ((!trimmed && !selectedPointId) || submitting || !activeClip || !anchor) return
    setSubmitting(true)

    const tempId = `temp_${Date.now()}`
    const capturedMs = anchor.clipMs
    const tempAnnotation: FilmAnnotationItem = {
      id: tempId,
      clipId: anchor.clip.id,
      gameId: activeClip.gameId,
      videoTimestampMs: capturedMs,
      text: trimmed,
      authorUsername: "",
      authorDisplayName: "You",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(selectedPointId ? { pointId: selectedPointId } : {}),
    }

    setAnnotations(prev => [...prev, tempAnnotation])
    const capturedText = trimmed
    const capturedPointId = selectedPointId
    setNewText("")
    setSelectedPointId(null)
    setShowPointPicker(false)

    try {
      const res = await fetch("/api/film/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: anchor.clip.id,
          videoTimestampMs: capturedMs,
          text: capturedText,
          ...(capturedPointId ? { pointId: capturedPointId } : {}),
        }),
      })
      if (res.ok) {
        const confirmed: FilmAnnotationItem = await res.json()
        setAnnotations(prev => prev.map(a => a.id === tempId ? confirmed : a))
      } else {
        setAnnotations(prev => prev.filter(a => a.id !== tempId))
        setNewText(capturedText)
      }
    } catch {
      setAnnotations(prev => prev.filter(a => a.id !== tempId))
      setNewText(capturedText)
    } finally {
      setSubmitting(false)
    }
  }, [activeClip, mainAnchorNow, newText, selectedPointId, submitting])

  const pointMap = useMemo(() => Object.fromEntries(points.map(p => [p.id, p])), [points])
  const taggedPointIds = useMemo(
    () => new Set(annotations.filter(a => a.pointId && !a.id.startsWith("temp_")).map(a => a.pointId!)),
    [annotations]
  )
  const untaggedPoints = useMemo(() => points.filter(p => !taggedPointIds.has(p.id)), [points, taggedPointIds])
  const selectedPoint = selectedPointId ? pointMap[selectedPointId] : null

  const toggleBtn = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs font-medium transition-colors ${active ? "bg-white/20 text-white" : "text-white/40 hover:text-white/70"}`

  if (!activeClip) {
    return <div className="text-white/30 text-sm p-4">No clips available.</div>
  }

  const openSync = (trackId: string) => {
    playerRef.current?.pause()
    isPlayingRef.current = false
    setIsPaused(true)
    setSyncTrackId(trackId)
  }
  // The viewer's player remounts after the sync editor closes — resume at the same game moment
  const closeSync = () => {
    const target = lastMainMsRef.current
    setSyncTrackId(null)
    setPlayerReady(false)
    transitioningRef.current = true
    if (activeTrackId === MAIN_TRACK_ID) {
      const loc = locateMain(mainTimeline, target)
      if (loc) { setActiveClipIdx(loc.idx); pendingSeekRef.current = loc.clipMs / 1000 }
    } else {
      const hit = mainToAngle(target, coverageByTrack.get(activeTrackId) ?? [])
      if (hit) { setAngleClipId(hit.clipId); setNoCoverageMainMs(null); pendingSeekRef.current = hit.clipMs / 1000 }
      else { setNoCoverageMainMs(target); transitioningRef.current = false }
    }
  }

  if (syncTrackId && canAnnotate && (angleClipsByTrack.get(syncTrackId)?.length ?? 0) > 0) {
    return (
      <SyncEditor
        trackName={trackName(syncTrackId)}
        mainClips={clips}
        angleClips={angleClipsByTrack.get(syncTrackId) ?? []}
        mainTimeline={mainTimeline}
        durationMsOf={durationMsOf}
        startMainMs={lastMainMsRef.current}
        onSyncPointsChange={(clipId: string, syncPoints: FilmSyncPoint[]) =>
          setAllClips(prev => prev.map(c => c.id === clipId ? { ...c, syncPoints } : c))}
        onClose={closeSync}
      />
    )
  }

  const onAngle = activeTrackId !== MAIN_TRACK_ID
  const activeTrackName = trackName(activeTrackId)
  const nextSpan = onAngle && noCoverageMainMs !== null
    ? nextCoverage(noCoverageMainMs, coverageByTrack.get(activeTrackId) ?? [])
    : null
  const followerTrackId = splitTrackId && !isFullscreen
    ? (splitTrackId !== activeTrackId ? splitTrackId : allTracks.find(t => t.id !== activeTrackId)?.id ?? null)
    : null

  const togglePlayPause = () => {
    if (!playerReady) return
    if (isPaused) playerRef.current?.play()
    else playerRef.current?.pause()
  }

  const toggleMute = () => {
    if (!playerRef.current) return
    const next = !isMuted
    playerRef.current.muted = next
    setIsMuted(next)
  }

  const overlayVisible = !isFullscreen || isPaused || overlayHovered || overlayRecentKey || (canAnnotate && editMode)
  const hasLanes = totalDurationMs > 0 && (globalEventMarks.length > 0 || angleTracks.length > 0)
  const laneSummary = [
    globalEventMarks.length > 0 && "events",
    angleTracks.length > 0 && "angles",
  ].filter(Boolean).join(" · ")

  const controlsArea = (
    <div className={isFullscreen
      ? "flex flex-col gap-2"
      : "flex flex-col gap-2"
    }>
      {/* Timeline lanes — live events and angle coverage, collapsible as one group above the scrubber */}
      {hasLanes && (
        <div className="flex flex-col gap-1">
          <SectionToggle
            open={layout.lanes}
            label="Timeline lanes"
            detail={laneSummary}
            onClick={() => updateLayout({ lanes: !layout.lanes })}
          />
          {layout.lanes && (
            <div className="flex flex-col gap-1">
            {/* Live-recorded point events for tagged points */}
            {globalEventMarks.length > 0 && (
              <div className="relative h-3">
                {globalEventMarks.map(({ event, point, globalMs }) => {
                  const pct = Math.min(100, Math.max(0, (globalMs / totalDurationMs) * 100))
                  const who = describeEvent(event)
                  return (
                    <button
                      key={event.id}
                      onClick={() => { choosePoint(point.id); seekGlobal(globalMs) }}
                      className={`absolute top-0 bottom-0 w-1 -translate-x-1/2 rounded-full opacity-80 hover:opacity-100 hover:scale-x-150 transition ${POINT_EVENT_META[event.eventType].dot}`}
                      style={{ left: `${pct}%` }}
                      title={`P${point.pointNumber} · ${POINT_EVENT_META[event.eventType].label}${who ? ` · ${who}` : ""} · ${formatTime(globalMs)}`}
                      aria-label={`${POINT_EVENT_META[event.eventType].label} at ${formatTime(globalMs)}`}
                    />
                  )
                })}
              </div>
            )}

            {/* Camera angle coverage — where each angle has synced footage; click to watch it from there */}
            {angleTracks.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {angleTracks.map(t => {
                  const active = t.id === activeTrackId
                  return (
                    <div
                      key={t.id}
                      className="relative h-3 rounded bg-white/[0.04] cursor-pointer overflow-hidden"
                      title={`${t.name} — click to watch this angle from here`}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        switchTrack(t.id, ((e.clientX - rect.left) / rect.width) * totalDurationMs)
                      }}
                    >
                      {(coverageByTrack.get(t.id) ?? []).map(span => {
                        const start = Math.max(0, span.mainStartMs)
                        const end = Math.min(totalDurationMs, span.mainEndMs)
                        if (end <= start) return null
                        return (
                          <div
                            key={`${span.clipId}-${span.clipStartMs}`}
                            className={`absolute top-0 bottom-0 ${active ? "bg-sky-300/70" : "bg-sky-300/30 hover:bg-sky-300/45"}`}
                            style={{ left: `${(start / totalDurationMs) * 100}%`, width: `${((end - start) / totalDurationMs) * 100}%` }}
                          />
                        )
                      })}
                      <span className={`absolute left-1 top-0 text-[9px] leading-3 pointer-events-none ${active ? "text-white" : "text-white/45"}`}>{t.name}</span>
                    </div>
                  )
                })}
              </div>
            )}
            </div>
          )}
        </div>
      )}

      {/* Global timeline scrubber — always rendered so controls are visible while loading */}
      <div
        ref={timelineRef}
        className={`relative h-7 select-none ${totalDurationMs > 0 ? "cursor-pointer" : "cursor-default"}`}
        onMouseDown={totalDurationMs > 0 ? handleTimelineMouseDown : undefined}
        onMouseMove={handleTimelineMouseMove}
        onMouseEnter={handleTimelineMouseEnter}
        onMouseLeave={handleTimelineMouseLeave}
        onTouchStart={totalDurationMs > 0 ? handleTimelineTouchStart : undefined}
      >
        {/* Track — doubles as the point strip: one colored band per tagged point, positioned by time */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-3 rounded-[4px] overflow-hidden bg-white/[0.07] pointer-events-none">
          {totalDurationMs > 0 && globalMetaSegments.map(({ point, markerAnn, globalStart, segEnd }) => {
            const start = Math.max(0, Math.min(globalStart, totalDurationMs))
            const end = Math.max(start, Math.min(segEnd, totalDurationMs))
            const widthPct = ((end - start) / totalDurationMs) * 100
            const isActive = point.id === activePointId
            return (
              <div
                key={markerAnn.id}
                className={`absolute top-0 bottom-0 flex items-center justify-center overflow-hidden border-l border-black/70 text-[8px] font-mono leading-none text-white/90 ${getPointColor(point.lineType, point.outcome)} ${isActive ? "opacity-90" : "opacity-45"}`}
                style={{ left: `${(start / totalDurationMs) * 100}%`, width: `${widthPct}%` }}
              >
                {widthPct > 3.5 ? `P${point.pointNumber}` : ""}
              </div>
            )
          })}
          {/* Played progress */}
          <div ref={progressRef} className="absolute bottom-0 left-0 h-[2px] bg-white" style={{ width: "0%" }} />
        </div>

        {/* Clip boundary markers */}
        {totalDurationMs > 0 && clipOffsets.slice(1).map((offset, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px pointer-events-none"
            style={{ left: `${(offset / totalDurationMs) * 100}%`, backgroundColor: "rgba(255,255,255,0.45)", boxShadow: "0 0 3px rgba(255,255,255,0.2)" }}
          />
        ))}

        {/* Annotation markers */}
        {totalDurationMs > 0 && globalAnnotations.map(a => (
          <AnnotationMarker
            key={a.id}
            annotation={a}
            durationMs={totalDurationMs}
            onSeek={(ms) => seekGlobal(ms)}
            pointData={a.pointId ? pointMap[a.pointId] : undefined}
          />
        ))}

        {/* Hover preview line + tooltip — opacity toggled directly via ref */}
        <div
          ref={hoverLineRef}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: "0%", opacity: 0 }}
        >
          <div className="absolute inset-y-0 left-0 w-px" style={{ backgroundColor: "rgba(255,255,255,0.25)" }} />
          <span
            ref={hoverTooltipRef}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 text-[10px] font-mono whitespace-nowrap px-1.5 py-0.5 rounded pointer-events-none"
            style={{ backgroundColor: "rgba(0,0,0,0.75)", color: "rgba(255,255,255,0.7)" }}
          />
        </div>

        {/* Playhead */}
        <div ref={playheadRef} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: "0%" }}>
          <div className="absolute inset-y-0 left-0 w-px bg-white" />
          <div
            className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white"
            style={{ boxShadow: "0 0 0 2px rgba(255,255,255,0.15), 0 0 8px rgba(255,255,255,0.3)" }}
          />
        </div>
      </div>

      {/* Control bar — on narrow screens the clip pills drop to their own scrollable row */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-0.5" onClick={e => e.stopPropagation()}>
        <button
          onClick={togglePlayPause}
          className="text-white hover:text-white/70 transition-colors shrink-0"
          aria-label={isPaused ? "Play" : "Pause"}
        >
          {isPaused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
        </button>
        <span ref={timecodeRef} className="text-[11px] font-mono text-white/50 tabular-nums shrink-0 min-w-[80px]">
          {formatTime(globalMs)} / {totalDurationMs > 0 ? formatTime(totalDurationMs) : "--:--"}
        </span>
        {allTracks.length > 1 && (
          <div className="flex items-center gap-0.5 rounded-md bg-white/5 p-0.5 max-w-full overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Camera angle">
            {allTracks.map((t, i) => (
              <button
                key={t.id}
                onClick={() => switchTrack(t.id)}
                title={`${t.name} (${i + 1})`}
                className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${t.id === activeTrackId ? "bg-sky-300/25 text-white" : "text-white/45 hover:text-white/80"}`}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        {clips.length > 1 && (
          <div className="order-last basis-full sm:order-none sm:basis-0 flex-1 min-w-0 flex items-center sm:justify-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {clips.map((clip, i) => (
              <button
                key={clip.id}
                onClick={() => jumpToClip(i)}
                className={`shrink-0 whitespace-nowrap px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  i === activeClipIdx
                    ? "bg-white/20 text-white"
                    : "bg-white/5 text-white/40 hover:text-white/60 hover:bg-white/10"
                }`}
              >
                {i === activeClipIdx && <span className="w-1.5 h-1.5 rounded-full bg-white/60 shrink-0" />}
                {clip.title ?? `Clip ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2.5 shrink-0">
          {allTracks.length > 1 && !isFullscreen && (
            <button
              onClick={() => setSplitTrackId(cur => cur ? null : (allTracks.find(t => t.id !== activeTrackId)?.id ?? null))}
              className={`transition-colors ${splitTrackId ? "text-sky-300" : "text-white/50 hover:text-white"}`}
              title="Side-by-side angles (V)"
              aria-label="Toggle side-by-side angles"
            >
              <Columns2 size={15} />
            </button>
          )}
          {canAnnotate && angleTracks.length > 0 && !isFullscreen && (
            <button
              onClick={() => openSync(onAngle ? activeTrackId : angleTracks[0].id)}
              className="text-white/50 hover:text-white transition-colors"
              title="Sync camera angles to Main"
              aria-label="Open angle sync editor"
            >
              <Link2 size={15} />
            </button>
          )}
          <button
            onClick={toggleMute}
            className="text-white/50 hover:text-white transition-colors"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button
            onClick={toggleFullscreen}
            className="text-white/50 hover:text-white transition-colors"
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Left: video + controls */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div
          ref={containerRef}
          className={isFullscreen ? "relative bg-black h-full" : "relative flex flex-col gap-2"}
        >
          {/* Video area — clicks inside the iframe are handled by YouTube's own controls */}
          <div
            className={isFullscreen ? "absolute inset-0 overflow-hidden" : `w-full mx-auto ${followerTrackId ? "grid md:grid-cols-2 gap-2" : ""}`}
            style={isFullscreen || !videoFit ? undefined : { maxWidth: videoAreaMaxWidth(videoFit, !!followerTrackId) }}
          >
            <div
              className={isFullscreen
                ? "absolute inset-0 w-full h-full"
                : "w-full aspect-video rounded-xl overflow-hidden bg-black relative"
              }
            >
              <YouTubePlayer
                ref={playerRef}
                videoId={activeSrc}
                className="absolute inset-0"
                onCanPlay={handleCanPlay}
                onPlay={() => { isPlayingRef.current = true; setIsPaused(false) }}
                onPause={() => {
                  // Ignore pause events fired during a programmatic clip change
                  if (!transitioningRef.current) { isPlayingRef.current = false; setIsPaused(true) }
                }}
                onEnd={handleEnd}
                onError={handleError}
                onDurationChange={handleDurationChange}
              />
              {playerError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <p className="text-sm text-red-400/80 text-center px-6">{playerError}</p>
                </div>
              ) : !playerReady && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-6 h-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              )}
              {onAngle && noCoverageMainMs !== null && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/90 px-4 text-center">
                  <VideoOff size={22} className="text-white/40" />
                  <p className="text-sm text-white/60">No {activeTrackName} footage at {formatTime(noCoverageMainMs)}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      onClick={() => switchTrack(MAIN_TRACK_ID)}
                      className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs text-white transition-colors"
                    >
                      Watch Main here <kbd className="ml-1 font-mono text-[10px] text-white/40">1</kbd>
                    </button>
                    {nextSpan && (
                      <button
                        onClick={() => seekAngle(activeTrackId, nextSpan.mainStartMs)}
                        className="px-3 py-1.5 rounded-md border border-white/15 hover:border-white/30 text-xs text-white/70 hover:text-white transition-colors"
                      >
                        Next {activeTrackName} footage at {formatTime(nextSpan.mainStartMs)} →
                      </button>
                    )}
                  </div>
                </div>
              )}
              {onAngle && angleUnsynced && noCoverageMainMs === null && (
                <div className="absolute top-2 inset-x-2 z-10 flex items-center gap-2 rounded-lg border border-amber-300/30 bg-black/70 px-3 py-1.5 text-xs text-amber-100">
                  This stretch of {activeTrackName} isn&apos;t synced to Main, so the timeline holds here.
                  {canAnnotate && (
                    <button onClick={() => openSync(activeTrackId)} className="ml-auto shrink-0 underline underline-offset-2 hover:text-white">
                      Sync…
                    </button>
                  )}
                </div>
              )}
            </div>
            {followerTrackId && (
              <FollowerPlayer
                key={followerTrackId}
                trackName={trackName(followerTrackId)}
                clips={followerTrackId === MAIN_TRACK_ID ? clips : angleClipsByTrack.get(followerTrackId) ?? []}
                coverage={coverageByTrack.get(followerTrackId) ?? []}
                getMainMs={getMainMsNow}
                playing={!isPaused}
                header={
                  <div className="flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px]">
                    <select
                      value={followerTrackId}
                      onChange={e => { setSplitTrackId(e.target.value); e.currentTarget.blur() }}
                      className="bg-transparent text-white/80 focus:outline-none"
                      aria-label="Second angle"
                    >
                      {allTracks.filter(t => t.id !== activeTrackId).map(t => (
                        <option key={t.id} value={t.id} className="bg-neutral-900">{t.name}</option>
                      ))}
                    </select>
                    <button onClick={() => setSplitTrackId(null)} className="text-white/40 hover:text-white" aria-label="Close split view">×</button>
                  </div>
                }
              />
            )}
          </div>
          {isFullscreen && !overlayVisible && (
            // Invisible hover strip above YouTube's own control bar (kept clear for its quality menu)
            <div className="absolute inset-x-0 bottom-14 h-24 z-20" onMouseEnter={() => setOverlayHovered(true)} />
          )}
          <div
            ref={chromeRef}
            className={isFullscreen
              ? `absolute inset-x-0 bottom-14 z-20 flex flex-col gap-2 px-4 pt-12 pb-3 bg-gradient-to-t from-black/90 via-black/70 to-transparent transition-opacity duration-300 ${overlayVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`
              : "flex flex-col gap-2"}
            onMouseEnter={isFullscreen ? () => setOverlayHovered(true) : undefined}
            onMouseLeave={isFullscreen ? () => setOverlayHovered(false) : undefined}
          >
            {controlsArea}
            {(editorPoint || globalMetaSegments.length > 0 || canAnnotate) && (
              <div>
                {!layout.editor ? (
                  <div className="rounded-xl border border-white/10 px-3 py-1.5">
                    <SectionToggle
                      open={false}
                      label="Point timeline"
                      detail={editorPoint ? `Point ${editorPoint.pointNumber} · ${(eventsByPoint.get(editorPoint.id) ?? NO_EVENTS).length} events` : undefined}
                      onClick={() => updateLayout({ editor: true })}
                    />
                  </div>
                ) : editorPoint && editorMarker ? (
                  <PointEventEditor
                    point={editorPoint}
                    events={eventsByPoint.get(editorPoint.id) ?? NO_EVENTS}
                    players={players}
                    rangeMs={editorRangeMs}
                    getPlayheadMs={getEditorPlayheadMs}
                    onSeek={seekEditor}
                    onEdit={editEditorPoint}
                    undo={pointEventsDoc.undo}
                    redo={pointEventsDoc.redo}
                    canUndo={pointEventsDoc.canUndo}
                    canRedo={pointEventsDoc.canRedo}
                    saveStatus={pointEventsDoc.saveStatus}
                    saveError={pointEventsDoc.saveError}
                    onRetrySave={pointEventsDoc.retrySave}
                    onSaveLine={saveEditorLine}
                    editable={canAnnotate && editMode}
                    onToggleEdit={canAnnotate ? toggleEditMode : undefined}
                    onCollapse={() => updateLayout({ editor: false })}
                    isPaused={isPaused}
                  />
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs text-white/35">
                    <span className="flex-1">
                      {globalMetaSegments.length > 0
                        ? <>Play or scrub into a tagged point (or press <kbd className="font-mono text-white/60">]</kbd>) to see its timeline.</>
                        : "Tag a point at its pull to start building its timeline against the film."}
                    </span>
                    <button onClick={() => updateLayout({ editor: false })} className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/35 hover:text-white/70" aria-label="Hide point timeline">
                      <ChevronRight size={11} className="rotate-90" /> Hide
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: sidebar */}
      {!layout.sidebar && !isFullscreen && (
        <button
          onClick={() => updateLayout({ sidebar: true })}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/45 hover:text-white hover:border-white/25 transition-colors lg:w-9 lg:self-start lg:px-0 lg:py-3 lg:[writing-mode:vertical-rl]"
          title="Show points & notes"
        >
          <PanelRightOpen size={13} className="lg:rotate-90" /> Points &amp; notes
        </button>
      )}
      {layout.sidebar && !isFullscreen && (
        <div className="w-full lg:w-80 shrink-0 flex flex-col border border-white/10 rounded-xl overflow-hidden lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100dvh-2rem)]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
            <span className="text-sm font-semibold">Game Film</span>
            {points.length > 0 && (
              <span className="text-xs bg-white/10 rounded-full px-2 py-0.5 font-mono tabular-nums">
                {points.length} pts
              </span>
            )}
            <span className="ml-auto text-[10px] text-white/25 font-mono">[ ] nav</span>
          <button
            onClick={() => updateLayout({ sidebar: false })}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            title="Hide points & notes"
          >
            <PanelRightClose size={13} /> Hide
          </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5 min-h-0 max-h-[50vh] lg:max-h-none">
            {sidebarEntries.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-6">No points or notes yet.</p>
            ) : (
              sidebarEntries.map(entry => {
                if (entry.kind === "point") {
                  const { point, markerAnn, textAnns } = entry
                  const isActive = activePointId === point.id
                  const isTagged = !!markerAnn
                  const clipIdx = markerAnn ? clips.findIndex(c => c.id === markerAnn.clipId) : -1
                  const showClipBadge = isTagged && clipIdx !== activeClipIdx
                  const pointEvents = eventsByPoint.get(point.id) ?? NO_EVENTS
                  const isExpanded = expandedPointIds.has(point.id)
                  const toggleExpanded = () => setExpandedPointIds(prev => {
                    const next = new Set(prev)
                    if (next.has(point.id)) next.delete(point.id)
                    else next.add(point.id)
                    return next
                  })

                  return (
                    <div
                      key={point.id}
                      className={`rounded-lg border transition-colors ${isActive ? "border-white/20 bg-white/5" : "border-transparent"}`}
                    >
                      <div className="flex items-center">
                        <button
                          onClick={toggleExpanded}
                          disabled={pointEvents.length === 0}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Hide" : "Show"} events for point ${point.pointNumber}`}
                          className="shrink-0 pl-1.5 pr-0.5 py-2 text-white/30 hover:text-white/70 disabled:opacity-0 transition-colors"
                        >
                          <ChevronRight size={12} className={`transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        </button>
                        <button
                          onClick={isTagged ? () => jumpToAnnotation(markerAnn!) : undefined}
                          disabled={!isTagged}
                          className={`flex-1 min-w-0 flex items-center gap-2 pl-1 pr-3 py-2 text-left rounded-lg transition-colors ${
                            isTagged ? "hover:bg-white/5 cursor-pointer" : "cursor-default opacity-50"
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-sm shrink-0 ${
                              isTagged ? getPointColor(point.lineType, point.outcome) : "border border-white/20"
                            }`}
                          />
                          <span className="text-xs font-mono text-white/70 shrink-0">P{point.pointNumber}</span>
                          <span className="text-xs text-white/50">{point.lineType}-line</span>
                          {point.outcome !== "IN_PROGRESS" && (
                            <span className="text-xs text-white/40">{point.outcome}</span>
                          )}
                          <span className="text-xs text-white/30 font-mono ml-auto shrink-0">
                            {point.voidScoreBefore}–{point.opponentScoreBefore}
                          </span>
                          {showClipBadge && (
                            <span className="text-[9px] bg-white/10 rounded px-1 py-0.5 text-white/40 shrink-0">
                              Clip {clipIdx + 1}
                            </span>
                          )}
                          {isTagged && markerAnn && (
                            <span className="text-[10px] font-mono text-purple-400/60 shrink-0">
                              {formatTime(getGlobalMs(markerAnn))}
                            </span>
                          )}
                        </button>
                      </div>

                      {isExpanded && pointEvents.length > 0 && (() => {
                        const offsets = resolveOffsets(pointEvents)
                        const base = markerAnn ? getGlobalMs(markerAnn) : null
                        const ordered = [...pointEvents].sort((a, b) => offsets.get(a.id)! - offsets.get(b.id)! || a.sortOrder - b.sortOrder)
                        return (
                          <div className="ml-6 mr-2 mb-1.5 flex flex-col border-l border-white/10">
                            {ordered.map(ev => {
                              const meta = POINT_EVENT_META[ev.eventType]
                              const evGlobal = base !== null ? base + offsets.get(ev.id)! : null
                              const who = describeEvent(ev)
                              return (
                                <button
                                  key={ev.id}
                                  onClick={evGlobal !== null ? () => { choosePoint(point.id); seekGlobal(evGlobal) } : undefined}
                                  disabled={evGlobal === null}
                                  className="flex items-center gap-2 pl-2.5 pr-1 py-1 text-left rounded-r hover:bg-white/5 disabled:hover:bg-transparent disabled:cursor-default transition-colors"
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                                  <span className={`text-xs shrink-0 ${meta.text}`}>{meta.label}</span>
                                  {who && <span className="text-xs text-white/50 truncate">{who}</span>}
                                  {evGlobal !== null && (
                                    <span className="ml-auto text-[10px] font-mono text-white/30 shrink-0">{formatTime(evGlobal)}</span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })()}

                      {!isTagged && canAnnotate && (
                        <div className="px-4 pb-1.5">
                          <button
                            onClick={() => addPointTag(point)}
                            className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                          >
                            + Tag at {formatTime(globalMs)}
                          </button>
                        </div>
                      )}

                      {textAnns.map(ann => (
                        <button
                          key={ann.id}
                          onClick={() => jumpToAnnotation(ann)}
                          className={`w-full flex items-start gap-3 px-4 py-1.5 text-left hover:bg-white/3 transition-colors rounded-b-lg ${ann.id.startsWith("temp_") ? "opacity-60" : ""}`}
                        >
                          <span className="text-[10px] font-mono text-purple-400/50 shrink-0 mt-0.5 min-w-[36px]">
                            {formatTime(getGlobalMs(ann))}
                          </span>
                          <p className="text-xs text-white/60 flex-1 min-w-0">{ann.text}</p>
                        </button>
                      ))}
                    </div>
                  )
                }

                const { ann } = entry
                const isTemp = ann.id.startsWith("temp_")
                const annClipIdx = clips.findIndex(c => c.id === ann.clipId)
                const showAnnClipBadge = annClipIdx !== activeClipIdx

                return (
                  <button
                    key={ann.id}
                    onClick={() => jumpToAnnotation(ann)}
                    className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border border-white/5 hover:border-white/15 hover:bg-white/3 text-left transition-colors ${isTemp ? "opacity-60" : ""}`}
                  >
                    <span className="text-[10px] font-mono text-purple-400 shrink-0 mt-0.5 min-w-[36px]">
                      {formatTime(getGlobalMs(ann))}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/80">{ann.text}</p>
                      <p className="text-xs text-white/30 mt-0.5 flex items-center gap-1.5">
                        {authorLabel(ann.authorDisplayName)}
                        {showAnnClipBadge && (
                          <span className="text-[9px] bg-white/10 rounded px-1 py-0.5 text-white/40">
                            Clip {annClipIdx + 1}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {canAnnotate && (
            <div className="border-t border-white/10 p-3 flex flex-col gap-2 shrink-0">
              {selectedPoint && (
                <div className="flex items-center gap-2 text-xs bg-white/5 rounded-lg px-2 py-1.5">
                  <span className={`w-2 h-2 rounded-sm shrink-0 ${getPointColor(selectedPoint.lineType, selectedPoint.outcome)}`} />
                  <span className="text-white/60">Tagging Point {selectedPoint.pointNumber}</span>
                  <button
                    onClick={() => setSelectedPointId(null)}
                    className="ml-auto text-white/30 hover:text-white/60 transition-colors"
                  >
                    ×
                  </button>
                </div>
              )}

              <div className="flex gap-2 items-center">
                <span className="text-xs text-white/30 font-mono shrink-0">{formatTime(globalMs)}</span>
                <input
                  value={newText}
                  onChange={e => setNewText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addAnnotation() } }}
                  placeholder={selectedPoint ? `Note for Point ${selectedPoint.pointNumber}…` : "Add note…"}
                  maxLength={500}
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                />
                <button
                  onClick={addAnnotation}
                  disabled={(!newText.trim() && !selectedPointId) || submitting}
                  className="px-3 py-2 bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-white transition-colors shrink-0"
                >
                  {selectedPoint && !newText.trim() ? "Mark" : "Add"}
                </button>
              </div>

              <div className="border-t border-white/5 my-0.5" />

              <button
                onClick={() => showNewPointForm ? setShowNewPointForm(false) : openNewPointForm(points)}
                className="text-xs text-white/40 hover:text-white/70 transition-colors text-left flex items-center gap-1"
              >
                <span className="text-white/25">{showNewPointForm ? "▼" : "▶"}</span>
                + New Point
              </button>

              {showNewPointForm && (
                <div className="flex flex-col gap-2 bg-white/3 rounded-lg p-2.5 border border-white/8">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-white/40 w-10 shrink-0">Point</label>
                    <input
                      type="number"
                      min={1}
                      value={npNumber}
                      onChange={e => setNpNumber(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-12 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-white/25"
                    />
                    <span className="text-white/20 text-xs ml-auto">Void</span>
                    <input
                      type="number"
                      min={0}
                      value={npVoid}
                      onChange={e => setNpVoid(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-10 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-white/25"
                    />
                    <span className="text-white/20 text-xs">–</span>
                    <input
                      type="number"
                      min={0}
                      value={npOpp}
                      onChange={e => setNpOpp(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-10 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-white/25"
                    />
                    <span className="text-white/20 text-xs">Opp</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-white/40 w-10 shrink-0">Line</label>
                    <div className="flex gap-1">
                      <button onClick={() => setNpLine("O")} className={toggleBtn(npLine === "O")}>O</button>
                      <button onClick={() => setNpLine("D")} className={toggleBtn(npLine === "D")}>D</button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-white/40 w-10 shrink-0">Result</label>
                    <div className="flex gap-1">
                      <button onClick={() => setNpOutcome("HOLD")} className={toggleBtn(npOutcome === "HOLD")}>HOLD</button>
                      <button onClick={() => setNpOutcome("BREAK")} className={toggleBtn(npOutcome === "BREAK")}>BREAK</button>
                      <button onClick={() => setNpOutcome("—")} className={toggleBtn(npOutcome === "—")}>—</button>
                    </div>
                  </div>

                  {players.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => setShowPlayerPicker(p => !p)}
                        className="text-[10px] text-white/35 hover:text-white/60 transition-colors text-left"
                      >
                        {showPlayerPicker ? "▼" : "▶"} Players {npPlayerIds.length > 0 ? `(${npPlayerIds.length})` : "(optional)"}
                      </button>
                      {showPlayerPicker && (
                        <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                          {players
                            .filter(p => p.is_active)
                            .sort((a, b) => a.number - b.number)
                            .map(p => {
                              const selected = npPlayerIds.includes(p.id)
                              return (
                                <button
                                  key={p.id}
                                  onClick={() =>
                                    setNpPlayerIds(prev =>
                                      selected ? prev.filter(id => id !== p.id) : [...prev, p.id]
                                    )
                                  }
                                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors ${selected ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5"}`}
                                >
                                  <span className="font-mono text-white/30 w-6 text-right">{p.number}</span>
                                  <span>{p.first_name} {p.last_name}</span>
                                  {selected && <span className="ml-auto text-white/40">✓</span>}
                                </button>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={createAndTagPoint}
                    disabled={creatingPoint}
                    className="mt-0.5 w-full py-1.5 bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs text-white transition-colors"
                  >
                    {creatingPoint ? "Creating…" : `Create & Tag at ${formatTime(globalMs)}`}
                  </button>
                </div>
              )}

              {untaggedPoints.length > 0 && (
                <>
                  <button
                    onClick={() => setShowPointPicker(p => !p)}
                    className="text-xs text-white/30 hover:text-white/60 transition-colors text-left"
                  >
                    {showPointPicker ? "↑ Hide" : "↓ Tag existing point…"}
                  </button>
                  {showPointPicker && (
                    <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto border border-white/10 rounded-lg p-1 bg-black/40">
                      {untaggedPoints.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedPointId(p.id); setShowPointPicker(false) }}
                          className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left hover:bg-white/5 transition-colors"
                        >
                          <span className={`w-2 h-2 rounded-sm shrink-0 ${getPointColor(p.lineType, p.outcome)}`} />
                          <span className="font-mono text-white/70">P{p.pointNumber}</span>
                          <span className="text-white/40">{p.lineType}-line</span>
                          {p.outcome !== "IN_PROGRESS" && <span className="text-white/40">{p.outcome}</span>}
                          <span className="text-white/30 font-mono ml-auto">{p.voidScoreBefore}–{p.opponentScoreBefore}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
