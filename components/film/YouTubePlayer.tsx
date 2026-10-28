"use client"

import { useEffect, useImperativeHandle, useRef, type Ref } from "react"

// Minimal typings for the YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference)
type YTPlayer = {
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  mute(): void
  unMute(): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  getVideoData?(): { video_id?: string }
  destroy(): void
}
type YTNamespace = {
  Player: new (el: HTMLElement, opts: {
    width: string
    height: string
    playerVars: Record<string, string | number>
    events: {
      onReady: () => void
      onStateChange: (e: { data: number }) => void
      onError: (e: { data: number }) => void
    }
  }) => YTPlayer
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const

const ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid YouTube video ID",
  5: "YouTube player error",
  100: "Video not found or private",
  101: "The owner doesn't allow this video to be embedded",
  150: "The owner doesn't allow this video to be embedded",
}

let apiPromise: Promise<YTNamespace> | null = null
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise(resolve => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT!) }
      const script = document.createElement("script")
      script.src = "https://www.youtube.com/iframe_api"
      document.head.appendChild(script)
    })
  }
  return apiPromise
}

export type YouTubePlayerHandle = {
  currentTime: number
  muted: boolean
  play(): void
  pause(): void
}

interface YouTubePlayerProps {
  ref?: Ref<YouTubePlayerHandle>
  videoId: string
  className?: string
  /** Fired when a newly loaded video is cued and ready to seek/play */
  onCanPlay?: () => void
  onPlay?: () => void
  onPause?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
  onDurationChange?: (seconds: number, videoId: string) => void
}

/**
 * YouTube IFrame player with YouTube's own controls shown — the gear menu is the only way to get HD,
 * since YouTube ignores programmatic quality requests and auto-selects low quality in embeds.
 * Videos are swapped with cueVideoById so the same iframe (and the viewer's quality pick) is reused.
 */
export function YouTubePlayer({ ref, videoId, className, ...callbacks }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const readyRef = useRef(false)
  const videoIdRef = useRef(videoId)
  const cuedStartRef = useRef(0)
  const mutedRef = useRef(false)
  const lastDurationRef = useRef(0)
  // Latest callbacks, read from event handlers registered once at player creation
  const callbacksRef = useRef(callbacks)
  useEffect(() => { callbacksRef.current = callbacks })

  useImperativeHandle(ref, () => ({
    get currentTime() {
      const p = playerRef.current
      if (!p || !readyRef.current) return 0
      return p.getPlayerState() === STATE.CUED ? cuedStartRef.current : p.getCurrentTime()
    },
    set currentTime(t: number) {
      const p = playerRef.current
      if (!p || !readyRef.current) return
      const state = p.getPlayerState()
      // seekTo from a cued/ended/unstarted state starts playback, so re-cue at the position instead
      if (state === STATE.CUED || state === STATE.ENDED || state === STATE.UNSTARTED) {
        if (state === STATE.CUED && Math.abs(t - cuedStartRef.current) < 0.25) return
        cuedStartRef.current = t
        p.cueVideoById({ videoId: videoIdRef.current, startSeconds: t })
      } else {
        p.seekTo(t, true)
      }
    },
    get muted() { return mutedRef.current },
    set muted(m: boolean) {
      mutedRef.current = m
      if (m) playerRef.current?.mute()
      else playerRef.current?.unMute()
    },
    play() { if (readyRef.current) playerRef.current?.playVideo() },
    pause() { if (readyRef.current) playerRef.current?.pauseVideo() },
  }), [])

  // Create the player once
  useEffect(() => {
    let cancelled = false
    let durationTimer: ReturnType<typeof setInterval> | undefined

    const reportDuration = () => {
      const p = playerRef.current
      if (!p || !readyRef.current) return
      const d = p.getDuration()
      if (d > 0 && d !== lastDurationRef.current) {
        lastDurationRef.current = d
        const id = p.getVideoData?.()?.video_id ?? videoIdRef.current
        callbacksRef.current.onDurationChange?.(d, id)
      }
    }

    loadYouTubeApi().then(YT => {
      if (cancelled || !containerRef.current) return
      const target = document.createElement("div")
      containerRef.current.appendChild(target)
      playerRef.current = new YT.Player(target, {
        width: "100%",
        height: "100%",
        playerVars: {
          controls: 1,
          fs: 0,              // fullscreen goes through the viewer so the timeline stays visible
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true
            cuedStartRef.current = 0
            playerRef.current?.cueVideoById({ videoId: videoIdRef.current })
            durationTimer = setInterval(reportDuration, 1000)
          },
          onStateChange: ({ data }) => {
            const cb = callbacksRef.current
            if (data === STATE.CUED) cb.onCanPlay?.()
            else if (data === STATE.PLAYING) cb.onPlay?.()
            else if (data === STATE.PAUSED) cb.onPause?.()
            else if (data === STATE.ENDED) { cb.onPause?.(); cb.onEnd?.() }
            reportDuration()
          },
          onError: ({ data }) => callbacksRef.current.onError?.(ERROR_MESSAGES[data] ?? "Failed to load video"),
        },
      })
    })

    return () => {
      cancelled = true
      clearInterval(durationTimer)
      playerRef.current?.destroy()
      playerRef.current = null
      readyRef.current = false
    }
  }, [])

  // Swap videos in the existing iframe
  useEffect(() => {
    if (videoIdRef.current === videoId) return
    videoIdRef.current = videoId
    lastDurationRef.current = 0
    cuedStartRef.current = 0
    if (readyRef.current) playerRef.current?.cueVideoById({ videoId })
  }, [videoId])

  return <div ref={containerRef} className={`[&>iframe]:w-full [&>iframe]:h-full ${className ?? ""}`} />
}
