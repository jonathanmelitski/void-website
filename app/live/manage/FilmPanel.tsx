"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { useFilmClips } from "@/hooks/use-film-clips"
import { useAuth } from "@/lib/use-auth"
import type { GameItem } from "@/lib/aws/games"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"

const FilmViewer = dynamic(
  () => import("@/components/film/FilmViewer").then(m => m.FilmViewer),
  { ssr: false }
)

interface EventSummary {
  id: string
  title: string
  date: string
}

function sortedByOrder(clips: FilmClipItem[]): FilmClipItem[] {
  return [...clips].sort((a, b) => {
    if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder
    if (a.sortOrder !== undefined) return -1
    if (b.sortOrder !== undefined) return 1
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

export function FilmPanel() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const isAdmin = !!(user?.groups?.includes("ADMIN"))

  const [ytStatus, setYtStatus] = useState<{ connected: boolean; channelTitle?: string } | null>(null)
  const [ytBanner, setYtBanner] = useState<{ kind: "success" | "error"; message: string } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    fetch("/api/youtube/connection").then(r => r.ok ? r.json() : null).then(setYtStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (searchParams.get("youtube_connected")) {
      setYtStatus(prev => prev ? { ...prev, connected: true } : null)
      setYtBanner({ kind: "success", message: "YouTube channel connected." })
    } else if (searchParams.get("youtube_error")) {
      const err = searchParams.get("youtube_error")
      setYtBanner({ kind: "error", message: err === "no_refresh_token" ? "No refresh token returned — try again." : `OAuth error: ${err}` })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const disconnect = async () => {
    if (!confirm("Disconnect YouTube channel? Existing playlists will remain on YouTube but new uploads will fail until reconnected.")) return
    setDisconnecting(true)
    await fetch("/api/youtube/connection", { method: "DELETE" })
    setYtStatus({ connected: false })
    setDisconnecting(false)
    setYtBanner(null)
  }

  const [events, setEvents] = useState<EventSummary[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [games, setGames] = useState<GameItem[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [viewerData, setViewerData] = useState<{ clips: FilmClipItem[]; annotations: FilmAnnotationItem[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const { clips, phases, loading, upload, resumeUpload, cancelUpload, deleteClip } = useFilmClips(selectedGameId)

  // Local clip order — maintained for drag-and-drop, initialized/updated from clips
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const resumeInputRef = useRef<HTMLInputElement | null>(null)
  const [resumingClipId, setResumingClipId] = useState<string | null>(null)

  // Sync orderedIds when clips list changes (new uploads, deletions)
  useEffect(() => {
    setOrderedIds(prev => {
      const knownIds = new Set(prev)
      const incoming = sortedByOrder(clips)
      const newClips = incoming.filter(c => !knownIds.has(c.id)).map(c => c.id)
      const existing = prev.filter(id => clips.some(c => c.id === id))
      return [...existing, ...newClips]
    })
  }, [clips])

  const orderedClips = orderedIds.map(id => clips.find(c => c.id === id)).filter(Boolean) as FilmClipItem[]

  useEffect(() => {
    fetch("/api/events").then(r => r.json()).then(data => {
      if (Array.isArray(data))
        setEvents(data.slice().sort((a: EventSummary, b: EventSummary) => new Date(b.date).getTime() - new Date(a.date).getTime()))
    })
  }, [])

  useEffect(() => {
    if (!selectedEventId) return
    fetch(`/api/games?eventId=${selectedEventId}`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setGames(data)
      setSelectedGameId(null)
    })
  }, [selectedEventId])

  const handleDrop = useCallback((targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null)
      setDropIdx(null)
      return
    }
    setOrderedIds(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(targetIdx, 0, moved)
      // Batch reorder: syncs DynamoDB and YouTube playlist order atomically
      fetch("/api/film/clips/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.map((id, idx) => ({ id, sortOrder: idx }))),
      }).catch(() => {})
      return next
    })
    setDragIdx(null)
    setDropIdx(null)
  }, [dragIdx])

  const openGameViewer = useCallback(async () => {
    const readyClips = orderedClips.filter(c => c.status === "READY")
    if (readyClips.length === 0) return
    const annArrays = await Promise.all(
      readyClips.map(c =>
        fetch(`/api/film/annotations?clipId=${c.id}`).then(r => r.ok ? r.json() : [])
      )
    )
    setViewerData({ clips: readyClips, annotations: (annArrays as FilmAnnotationItem[][]).flat() })
  }, [orderedClips])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ""
    if (files.length > 0) upload(files)
  }

  if (viewerData) {
    return (
      <div>
        <button
          onClick={() => setViewerData(null)}
          className="text-white/40 hover:text-white/70 text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Back to clips
        </button>
        <FilmViewer clips={viewerData.clips} initialAnnotations={viewerData.annotations} canAnnotate />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* YouTube channel connection */}
      <div className="flex flex-col gap-2">
        {ytBanner && (
          <div className={`text-xs px-3 py-2 rounded-lg ${ytBanner.kind === "success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
            {ytBanner.message}
            <button onClick={() => setYtBanner(null)} className="ml-2 opacity-50 hover:opacity-100">×</button>
          </div>
        )}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/10 text-sm">
          <div className="flex-1 min-w-0">
            {ytStatus === null ? (
              <span className="text-white/30 text-xs">Checking YouTube…</span>
            ) : ytStatus.connected ? (
              <span className="text-white/60 truncate">
                <span className="text-white/30 text-xs mr-2">YouTube</span>
                {ytStatus.channelTitle}
              </span>
            ) : (
              <span className="text-white/30 text-xs">No YouTube channel connected</span>
            )}
          </div>
          {ytStatus?.connected && isAdmin && (
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="text-xs text-white/30 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
          {ytStatus && !ytStatus.connected && isAdmin && (
            <a
              href="/api/youtube/auth"
              className="text-xs px-2.5 py-1.5 rounded-md bg-white/8 hover:bg-white/12 text-white/70 hover:text-white transition-colors"
            >
              Connect Channel
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="text-xs text-white/40 uppercase tracking-widest mb-1 block">Event</label>
          <select
            value={selectedEventId ?? ""}
            onChange={e => setSelectedEventId(e.target.value || null)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
          >
            <option value="">Select event…</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.title}</option>
            ))}
          </select>
        </div>

        {games.length > 0 && (
          <div className="flex-1">
            <label className="text-xs text-white/40 uppercase tracking-widest mb-1 block">Game</label>
            <select
              value={selectedGameId ?? ""}
              onChange={e => setSelectedGameId(e.target.value || null)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
            >
              <option value="">Select game…</option>
              {games.map(g => (
                <option key={g.id} value={g.id}>vs {g.opponent}{g.round ? ` (${g.round})` : ""}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {selectedGameId && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-white/70">Clips</h3>
            <div className="flex gap-2">
              {orderedClips.some(c => c.status === "READY") && (
                <Button size="sm" variant="ghost" onClick={openGameViewer}>
                  Review Film
                </Button>
              )}
              <input ref={fileInputRef} type="file" accept="video/*" multiple className="hidden" onChange={handleFileChange} />
              <input
                ref={resumeInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file && resumingClipId) resumeUpload(resumingClipId, file)
                  setResumingClipId(null)
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload Film
              </Button>
            </div>
          </div>

          {orderedClips.length > 1 && (
            <p className="text-[10px] text-white/25 -mt-2">Drag to reorder clips — sets playback order in the viewer</p>
          )}

          {loading ? (
            <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin" />
          ) : orderedClips.length === 0 ? (
            <p className="text-white/30 text-sm">No clips for this game yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {orderedClips.map((clip, i) => {
                const phase = phases[clip.id]
                const isDragging = dragIdx === i
                const isDropTarget = dropIdx === i && dragIdx !== null && dragIdx !== i

                return (
                  <div
                    key={clip.id}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={e => { e.preventDefault(); setDropIdx(i) }}
                    onDrop={() => handleDrop(i)}
                    onDragEnd={() => { setDragIdx(null); setDropIdx(null) }}
                    className={`flex flex-col gap-1.5 px-4 py-3 rounded-lg border transition-colors group cursor-grab active:cursor-grabbing ${
                      isDragging
                        ? "opacity-40 border-white/10"
                        : isDropTarget
                        ? "border-white/30 bg-white/5"
                        : "border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Drag handle */}
                      <span className="text-white/20 text-xs select-none shrink-0">⠿</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{clip.title ?? "Game Film"}</p>
                        {clip.durationSeconds && (
                          <p className="text-xs text-white/30 font-mono">
                            {Math.floor(clip.durationSeconds / 60)}:{String(Math.round(clip.durationSeconds % 60)).padStart(2, "0")}
                          </p>
                        )}
                      </div>
                      {phase?.tag === "interrupted" && (
                        <button
                          onClick={() => { setResumingClipId(clip.id); resumeInputRef.current?.click() }}
                          className="text-xs text-white/50 hover:text-white/80 transition-colors px-2"
                        >
                          Resume
                        </button>
                      )}
                      {phase?.tag === "error" && (
                        <span className="text-xs text-white/30 px-2">Delete and re-upload to retry</span>
                      )}
                      {phase?.tag === "uploading" && (
                        <button onClick={() => cancelUpload(clip.id)} className="text-white/30 hover:text-red-400 transition-colors text-xs px-2" aria-label="Cancel upload">Cancel</button>
                      )}
                      <button
                        onClick={() => { if (confirm(`Delete "${clip.title ?? "Game Film"}"?`)) deleteClip(clip.id) }}
                        className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all text-xs p-1"
                        aria-label="Delete clip"
                      >
                        ✕
                      </button>
                    </div>

                    {phase?.tag === "uploading" && (
                      <div className="flex flex-col gap-1">
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-white/50 rounded-full transition-[width] duration-300"
                            style={{ width: `${phase.percent}%` }}
                          />
                        </div>
                        <span className="text-xs text-white/40 tabular-nums">{phase.percent}%</span>
                      </div>
                    )}
                    {phase?.tag === "interrupted" && (
                      <span className="text-xs text-white/30 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        Upload interrupted — select the file again to resume
                      </span>
                    )}
                    {phase?.tag === "transcoding" && (
                      <span className="text-xs text-blue-400 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                        Processing on YouTube…
                      </span>
                    )}
                    {phase?.tag === "error" && (
                      <span className="text-xs text-red-400/80">{phase.message ?? "Error"}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
