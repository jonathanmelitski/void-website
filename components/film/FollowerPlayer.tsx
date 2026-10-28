"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { VideoOff } from "lucide-react"
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import { mainToAngle, type CoverageSpan } from "@/lib/film-tracks"

interface FollowerPlayerProps {
  trackName: string
  clips: FilmClipItem[]
  coverage: CoverageSpan[]
  /** Main film time of the lead player, null while it shows unsynced footage */
  getMainMs: () => number | null
  playing: boolean
  header?: React.ReactNode
}

const TICK_MS = 250
// YouTube can't fine-tune playback rate, so drift is corrected with seeks past these thresholds
const DRIFT_PLAYING_MS = 350
const DRIFT_PAUSED_MS = 80

/** A muted second angle slaved to the lead player's game time (split view) */
export function FollowerPlayer({ trackName, clips, coverage, getMainMs, playing, header }: FollowerPlayerProps) {
  const playerRef = useRef<YouTubePlayerHandle>(null)
  const [clipId, setClipId] = useState<string | null>(null)
  const [covered, setCovered] = useState(true)

  const loadedClipIdRef = useRef<string | null>(null)
  const readyRef = useRef(false)
  const pendingMsRef = useRef<number | null>(null)
  const followerPlayingRef = useRef(false)

  const latest = useRef({ coverage, getMainMs, playing })
  useEffect(() => { latest.current = { coverage, getMainMs, playing } })

  useEffect(() => {
    const id = setInterval(() => {
      const { coverage, getMainMs, playing } = latest.current
      const mainMs = getMainMs()
      const hit = mainMs === null ? null : mainToAngle(mainMs, coverage, loadedClipIdRef.current ?? undefined)
      if (!hit) {
        setCovered(false)
        if (followerPlayingRef.current) playerRef.current?.pause()
        return
      }
      setCovered(true)
      if (hit.clipId !== loadedClipIdRef.current) {
        loadedClipIdRef.current = hit.clipId
        readyRef.current = false
        pendingMsRef.current = hit.clipMs
        setClipId(hit.clipId)
        return
      }
      const p = playerRef.current
      if (!readyRef.current || !p) { pendingMsRef.current = hit.clipMs; return }
      const drift = Math.abs(p.currentTime * 1000 - hit.clipMs)
      if (drift > (playing ? DRIFT_PLAYING_MS : DRIFT_PAUSED_MS)) p.currentTime = hit.clipMs / 1000
      if (playing && !followerPlayingRef.current) p.play()
      if (!playing && followerPlayingRef.current) p.pause()
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  const handleCanPlay = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    p.muted = true
    if (pendingMsRef.current !== null) {
      p.currentTime = pendingMsRef.current / 1000
      pendingMsRef.current = null
    }
    readyRef.current = true
    if (latest.current.playing) p.play()
  }, [])

  const clip = clipId ? clips.find(c => c.id === clipId) : undefined

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      {clip && (
        <YouTubePlayer
          ref={playerRef}
          videoId={clip.youtubeVideoId}
          className="absolute inset-0"
          onCanPlay={handleCanPlay}
          onPlay={() => { followerPlayingRef.current = true }}
          onPause={() => { followerPlayingRef.current = false }}
          onEnd={() => { followerPlayingRef.current = false }}
        />
      )}
      {(!covered || !clip) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 text-white/40 pointer-events-none">
          <VideoOff size={20} />
          <span className="text-xs">No {trackName} footage here</span>
        </div>
      )}
      {header && <div className="absolute top-2 left-2 z-10">{header}</div>}
    </div>
  )
}
