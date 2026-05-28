"use client"

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react"
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings } from "lucide-react"
import { MediaPlayer, MediaProvider } from "@vidstack/react"
import type { MediaPlayerInstance } from "@vidstack/react"
import { AnnotationMarker } from "./AnnotationMarker"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"
import type { FilmAnnotationMessage } from "@/lib/ws-push"
import type { PointItem } from "@/lib/aws/points"
import type { PlayerItem } from "@/lib/aws/players"

interface FilmViewerProps {
  clips: FilmClipItem[]
  initialAnnotations: FilmAnnotationItem[]
  canAnnotate: boolean
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


export function FilmViewer({ clips, initialAnnotations, canAnnotate }: FilmViewerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null)
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
  const [playerReady, setPlayerReady] = useState(false)
  const [isPaused, setIsPaused] = useState(true)
  const [isMuted, setIsMuted] = useState(false)
  const [displayMs, setDisplayMs] = useState(0)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [showQuality, setShowQuality] = useState(false)
  const [qualityLabel, setQualityLabel] = useState("Auto")
  const [availableHeights, setAvailableHeights] = useState<number[]>([])
  // Persists preferred quality across clip switches: "auto" | height in pixels
  const qualityPrefRef = useRef<"auto" | number>("auto")

  const activeClip = clips[activeClipIdx]
  const activeSrc = activeClip
    ? activeClip.sourceType === "YOUTUBE"
      ? `youtube/${activeClip.youtubeVideoId}`
      : (activeClip.cloudfrontHlsUrl ?? "")
    : ""

  // Keep activeClipIdxRef in sync before paint so the RAF never reads a stale value
  useLayoutEffect(() => { activeClipIdxRef.current = activeClipIdx }, [activeClipIdx])

  // Reset display state whenever the active src changes (clip switch or clips prop reorder)
  useEffect(() => {
    if (!transitioningRef.current) setIsPaused(true)
    setDisplayMs(0)
    currentMsRef.current = 0
    setPlayerReady(false)
    setPlayerError(null)
  }, [activeSrc])

  // Clip durations come from MediaConvert metadata — never updated dynamically.
  // The boundary line is computed once from these and never moves during playback.
  const clipDurationsMs = useMemo(() => clips.map(c => (c.durationSeconds ?? 0) * 1000), [clips])
  const clipOffsets = useMemo(() => {
    const result: number[] = []
    let acc = 0
    for (const dur of clipDurationsMs) { result.push(acc); acc += dur }
    return result
  }, [clipDurationsMs])
  const totalDurationMs = useMemo(() => clipDurationsMs.reduce((a, b) => a + b, 0), [clipDurationsMs])
  const globalMs = (clipOffsets[activeClipIdx] ?? 0) + displayMs

  // Keep offset/duration refs in sync before paint so the RAF reads fresh values on every frame
  useLayoutEffect(() => { clipOffsetsRef.current = clipOffsets }, [clipOffsets])
  useLayoutEffect(() => { totalDurationMsRef.current = totalDurationMs }, [totalDurationMs])

  const [annotations, setAnnotations] = useState<FilmAnnotationItem[]>(initialAnnotations)
  const [newText, setNewText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [points, setPoints] = useState<PointItem[]>([])
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [activePointId, setActivePointId] = useState<string | null>(null)

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

  useEffect(() => {
    if (!gameId) return
    fetch(`/api/points?gameId=${gameId}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: PointItem[]) => {
        if (Array.isArray(data)) setPoints(data.sort((a, b) => a.pointNumber - b.pointNumber))
      })
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

  const seekGlobal = useCallback((targetMs: number) => {
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
    setActivePointId(ann.pointId ?? null)
    const targetIdx = clips.findIndex(c => c.id === ann.clipId)
    if (targetIdx === -1) return
    const startSec = ann.videoTimestampMs / 1000
    if (targetIdx === activeClipIdx) {
      currentMsRef.current = ann.videoTimestampMs
      if (playerRef.current) playerRef.current.currentTime = startSec
    } else {
      transitioningRef.current = true
      pendingSeekRef.current = startSec
      setActiveClipIdx(targetIdx)
    }
  }, [clips, activeClipIdx])

  const addPointTag = useCallback(async (point: PointItem) => {
    if (!activeClip) return
    const res = await fetch("/api/film/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clipId: activeClip.id,
        videoTimestampMs: Math.round(currentMsRef.current),
        text: "",
        pointId: point.id,
      }),
    })
    if (res.ok) {
      const annotation: FilmAnnotationItem = await res.json()
      setAnnotations(prev => [...prev, annotation])
      setActivePointId(point.id)
    }
  }, [activeClip])

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
          const gms = (clipOffsetsRef.current[activeClipIdxRef.current] ?? 0) + ct
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
            setDisplayMs(ct)
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

  useEffect(() => {
    if (!showQuality) return
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-quality-menu]")) setShowQuality(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [showQuality])

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
    if (hoverTooltipRef.current) hoverTooltipRef.current.textContent = formatTime((pct / 100) * totalDurationMs)
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
  }, [points, markerMap, activePointId, jumpToAnnotation])

  // Vidstack event handlers
  const handleError = useCallback((detail: { message: string } | unknown) => {
    const message = (detail && typeof detail === "object" && "message" in detail)
      ? String((detail as { message: string }).message)
      : "Failed to load video"
    transitioningRef.current = false
    setPlayerError(message)
    setPlayerReady(false)
    isPlayingRef.current = false
    setIsPaused(true)
  }, [])

  const applyQualityPref = useCallback(() => {
    const player = playerRef.current
    if (!player) return

    const qs = player.qualities
    if (qs.readonly) return

    // Iterate live quality objects — Array.from() yields stale proxy snapshots; for...of uses live refs
    const heights: number[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const q of qs as any) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = (q as any).height as number
      if (h > 0 && !heights.includes(h)) heights.push(h)
    }
    if (heights.length > 0) setAvailableHeights(heights.sort((a, b) => b - a))

    const pref = qualityPrefRef.current
    if (pref === "auto") {
      qs.autoSelect()
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const q of qs as any) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((q as any).height === pref) {
        // VideoQuality has no select() method — `selected` is the writable property from SelectListItem
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(q as any).selected = true
        return
      }
    }
  }, [])

  const selectQuality = useCallback((value: "auto" | number) => {
    qualityPrefRef.current = value
    setQualityLabel(value === "auto" ? "Auto" : `${value}p`)
    setShowQuality(false)
    applyQualityPref()
  }, [applyQualityPref])

  // Re-apply quality preference after each clip loads.
  // Delay 300ms: HLS.js ABR runs its initial level selection right at canPlay and would override an
  // immediate select() call, resetting auto=true. Waiting lets ABR settle first.
  useEffect(() => {
    if (!playerReady) return
    const id = setTimeout(applyQualityPref, 300)
    return () => clearTimeout(id)
  }, [playerReady, applyQualityPref])

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

  const handleEnd = useCallback(() => {
    const nextIdx = activeClipIdxRef.current + 1
    const hasNext = nextIdx < clips.length && (clips[nextIdx].cloudfrontHlsUrl || clips[nextIdx].youtubeVideoId)
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
    if (creatingPoint || !activeClip) return
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
          clipId: activeClip.id,
          videoTimestampMs: Math.round(currentMsRef.current),
          text: "",
          pointId: point.id,
        }),
      })
      if (annRes.ok) {
        const annotation: FilmAnnotationItem = await annRes.json()
        setAnnotations(prev => [...prev, annotation])
        setActivePointId(point.id)
      }

      setPoints(prev => [...prev, point].sort((a, b) => a.pointNumber - b.pointNumber))
      setShowNewPointForm(false)
    } finally {
      setCreatingPoint(false)
    }
  }, [activeClip, creatingPoint, npNumber, npVoid, npOpp, npLine, npOutcome, npPlayerIds])

  const addAnnotation = useCallback(async () => {
    const trimmed = newText.trim()
    if ((!trimmed && !selectedPointId) || submitting || !activeClip) return
    setSubmitting(true)

    const tempId = `temp_${Date.now()}`
    const capturedMs = Math.round(currentMsRef.current)
    const tempAnnotation: FilmAnnotationItem = {
      id: tempId,
      clipId: activeClip.id,
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
          clipId: activeClip.id,
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
  }, [activeClip, newText, selectedPointId, submitting])

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

  const controlsArea = (
    <div className={isFullscreen
      ? "absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-12 flex flex-col gap-2"
      : "flex flex-col gap-2"
    }>
      {/* Point segment strip — visible once duration is known */}
      {totalDurationMs > 0 && globalMetaSegments.length > 0 && (
        <div className="flex h-4 rounded-md overflow-hidden gap-px">
          {globalMetaSegments.map(({ point, markerAnn, globalStart, segEnd }) => {
            const widthPct = ((segEnd - globalStart) / totalDurationMs) * 100
            return (
              <button
                key={markerAnn.id}
                onClick={() => seekGlobal(globalStart)}
                className={`${getPointColor(point.lineType, point.outcome)} opacity-60 hover:opacity-95 transition-opacity text-[9px] font-mono text-white/90 flex items-center justify-center overflow-hidden shrink-0`}
                style={{ width: `${widthPct}%` }}
                title={`P${point.pointNumber} · ${point.lineType}-line · ${point.outcome} · ${point.voidScoreBefore}–${point.opponentScoreBefore}`}
              >
                {widthPct > 5 ? `P${point.pointNumber}` : ""}
              </button>
            )
          })}
        </div>
      )}

      {/* Global timeline scrubber — always rendered so controls are visible while loading */}
      <div
        ref={timelineRef}
        className={`relative h-9 select-none ${totalDurationMs > 0 ? "cursor-pointer" : "cursor-default"}`}
        onMouseDown={totalDurationMs > 0 ? handleTimelineMouseDown : undefined}
        onMouseMove={handleTimelineMouseMove}
        onMouseEnter={handleTimelineMouseEnter}
        onMouseLeave={handleTimelineMouseLeave}
        onTouchStart={totalDurationMs > 0 ? handleTimelineTouchStart : undefined}
      >
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full overflow-hidden"
          style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
        >
          {/* Active clip region highlight */}
          {totalDurationMs > 0 && (
            <div
              className="absolute top-0 h-full pointer-events-none"
              style={{
                backgroundColor: "rgba(255,255,255,0.12)",
                left: `${((clipOffsets[activeClipIdx] ?? 0) / totalDurationMs) * 100}%`,
                width: `${((clipDurationsMs[activeClipIdx] ?? 0) / totalDurationMs) * 100}%`,
              }}
            />
          )}
          {/* Played progress */}
          <div ref={progressRef} className="absolute top-0 left-0 h-full bg-white pointer-events-none" style={{ width: "0%" }} />
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

      {/* Control bar */}
      <div className="flex items-center gap-2 px-0.5" onClick={e => e.stopPropagation()}>
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
        <div className="flex-1 flex items-center justify-center gap-1 flex-wrap">
          {clips.length > 1 && clips.map((clip, i) => (
            <button
              key={clip.id}
              onClick={() => totalDurationMs > 0 && seekGlobal(clipOffsets[i] ?? 0)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
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
        <button
          onClick={toggleMute}
          className="text-white/50 hover:text-white transition-colors shrink-0"
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        {/* Quality selector */}
        <div className="relative shrink-0" data-quality-menu>
          <button
            onClick={() => setShowQuality(p => !p)}
            className="flex items-center gap-1 text-white/50 hover:text-white transition-colors"
            aria-label="Video quality"
          >
            <Settings size={14} className={showQuality ? "text-white" : ""} />
            <span className="text-[10px] font-mono tabular-nums">{qualityLabel}</span>
          </button>
          {showQuality && (
            <div className="absolute bottom-full right-0 mb-2 w-28 rounded-lg border border-white/15 overflow-hidden"
              style={{ background: "rgba(10,10,10,0.95)", backdropFilter: "blur(8px)" }}>
              <p className="text-[9px] uppercase tracking-widest text-white/30 px-3 pt-2 pb-1">Quality</p>
              {(["auto" as const, ...availableHeights]).map(val => {
                const label = val === "auto" ? "Auto" : `${val}p`
                const active = qualityLabel === label
                return (
                  <button
                    key={val}
                    onClick={() => selectQuality(val)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${active ? "text-white" : "text-white/50 hover:text-white"}`}
                  >
                    {label}
                    {active && <span className="w-1.5 h-1.5 rounded-full bg-white/60" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button
          onClick={toggleFullscreen}
          className="text-white/50 hover:text-white transition-colors shrink-0"
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* Left: video + controls */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div
          ref={containerRef}
          className={isFullscreen ? "relative flex flex-col bg-black" : "relative flex flex-col gap-2"}
        >
          {/* Video area — click to play/pause */}
          <div
            className={isFullscreen ? "flex-1 relative overflow-hidden min-h-0 cursor-pointer" : "cursor-pointer"}
            onClick={togglePlayPause}
          >
            <div
              className={isFullscreen
                ? "absolute inset-0 w-full h-full"
                : "w-full aspect-video rounded-xl overflow-hidden bg-black relative"
              }
            >
              <MediaPlayer
                ref={playerRef}
                src={activeSrc}
                className="absolute inset-0 w-full h-full"
                keyDisabled
                onCanPlay={handleCanPlay}
                onPlay={() => { isPlayingRef.current = true; setIsPaused(false) }}
                onPause={() => {
                  // Ignore pause events fired by Vidstack during a programmatic src change
                  if (!transitioningRef.current) { isPlayingRef.current = false; setIsPaused(true) }
                }}
                onEnd={handleEnd}
                onError={handleError}
              >
                <MediaProvider />
              </MediaPlayer>
              {playerError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <p className="text-sm text-red-400/80 text-center px-6">{playerError}</p>
                </div>
              ) : !playerReady && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>
          {controlsArea}
        </div>
      </div>

      {/* Right: sidebar */}
      <div className="w-full md:w-80 shrink-0 flex flex-col border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
          <span className="text-sm font-semibold">Game Film</span>
          {points.length > 0 && (
            <span className="text-xs bg-white/10 rounded-full px-2 py-0.5 font-mono tabular-nums">
              {points.length} pts
            </span>
          )}
          <span className="ml-auto text-[10px] text-white/25 font-mono">[ ] nav</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5 min-h-0 max-h-[50vh] md:max-h-none">
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

                return (
                  <div
                    key={point.id}
                    className={`rounded-lg border transition-colors ${isActive ? "border-white/20 bg-white/5" : "border-transparent"}`}
                  >
                    <button
                      onClick={isTagged ? () => jumpToAnnotation(markerAnn!) : undefined}
                      disabled={!isTagged}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg transition-colors ${
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
                      {ann.authorDisplayName}
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
    </div>
  )
}
