"use client"

import { useEffect, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { Pencil, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFilmClips } from "@/hooks/use-film-clips"
import type { GameItem } from "@/lib/aws/games"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"
import { MAIN_TRACK_ID, sortClips, trackIdOf, type FilmTrack } from "@/lib/film-tracks"
import { Spinner } from "@/components/ui/spinner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/components/ui/sonner"
import { apiFetch, errorMessage } from "@/lib/api-fetch"

const FilmViewer = dynamic(
  () => import("@/components/film/FilmViewer").then(m => m.FilmViewer),
  { ssr: false }
)
const FilmOverlay = dynamic(
  () => import("@/components/film/FilmOverlay").then(m => m.FilmOverlay),
  { ssr: false }
)

interface EventSummary {
  id: string
  title: string
  date: string
}

type ViewerData = { clips: FilmClipItem[]; annotations: FilmAnnotationItem[]; syncTrackId?: string }

export function FilmPanel() {
  const [events, setEvents] = useState<EventSummary[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [games, setGames] = useState<GameItem[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [viewerData, setViewerData] = useState<ViewerData | null>(null)

  const { clips, loading, importYoutube, deleteClip } = useFilmClips(selectedGameId)

  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)

  const [importUrl, setImportUrl] = useState("")
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const [selectedTrackId, setSelectedTrackId] = useState<string>(MAIN_TRACK_ID)
  const [trackDraft, setTrackDraft] = useState<{ id: string | null; name: string } | null>(null)
  const [trackError, setTrackError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FilmClipItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteClip(pendingDelete.id)
      toast.success("Film deleted")
      setPendingDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the film. Try again.")
    } finally {
      setDeleting(false)
    }
  }

  const game = games.find(g => g.id === selectedGameId) ?? null
  const angleTracks: FilmTrack[] = game?.filmTracks ?? []
  const tracks: FilmTrack[] = [{ id: MAIN_TRACK_ID, name: "Main" }, ...angleTracks]
  const selectedTrack = tracks.find(t => t.id === selectedTrackId) ?? tracks[0]

  useEffect(() => {
    setOrderedIds(prev => {
      const knownIds = new Set(prev)
      const incoming = sortClips(clips)
      const newClips = incoming.filter(c => !knownIds.has(c.id)).map(c => c.id)
      const existing = prev.filter(id => clips.some(c => c.id === id))
      return [...existing, ...newClips]
    })
  }, [clips])

  const orderedClips = orderedIds.map(id => clips.find(c => c.id === id)).filter(Boolean) as FilmClipItem[]
  const trackClips = orderedClips.filter(c => trackIdOf(c) === selectedTrack.id)

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

  // Reorder within the selected track; sortOrder is shared across tracks but only compared within one
  const handleDrop = useCallback((targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      setDropId(null)
      return
    }
    const prev = orderedIds
    const next = [...prev]
    next.splice(next.indexOf(dragId), 1)
    next.splice(next.indexOf(targetId), 0, dragId)
    setOrderedIds(next)
    apiFetch("/api/film/clips/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next.map((id, idx) => ({ id, sortOrder: idx }))),
      waitForSession: true,
    })
      .then(res => { if (!res.ok) throw new Error() })
      .catch(() => {
        // Put the list back the way it is saved
        setOrderedIds(cur => (cur === next ? prev : cur))
        toast.error("Couldn't save the new clip order. Try again.")
      })
    setDragId(null)
    setDropId(null)
  }, [dragId, orderedIds])

  const openGameViewer = useCallback(async (syncTrackId?: string) => {
    const readyClips = orderedClips.filter(c => c.status === "READY")
    if (!readyClips.some(c => trackIdOf(c) === MAIN_TRACK_ID)) return
    // Annotations live on the main track only
    const annArrays = await Promise.all(
      readyClips.filter(c => trackIdOf(c) === MAIN_TRACK_ID).map(c =>
        fetch(`/api/film/annotations?clipId=${c.id}`).then(r => r.ok ? r.json() : [])
      )
    )
    setViewerData({ clips: readyClips, annotations: (annArrays as FilmAnnotationItem[][]).flat(), syncTrackId })
  }, [orderedClips])

  const handleImport = async () => {
    if (!selectedGameId || !importUrl.trim()) return
    setImporting(true)
    setImportError(null)
    try {
      await importYoutube(importUrl.trim(), selectedTrack.id === MAIN_TRACK_ID ? undefined : selectedTrack.id)
      setImportUrl("")
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed")
    } finally {
      setImporting(false)
    }
  }

  const saveTracks = async (next: FilmTrack[]) => {
    if (!game) return false
    setTrackError(null)
    let res: Response
    try {
      res = await apiFetch(`/api/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filmTracks: next }),
        waitForSession: true,
      })
    } catch {
      setTrackError("Couldn't save the camera angles. Check your connection and try again.")
      toast.error("Couldn't save the camera angles.")
      return false
    }
    if (!res.ok) {
      const message = await errorMessage(res, "Couldn't save the camera angles. Try again.")
      setTrackError(message)
      toast.error(message)
      return false
    }
    setGames(prev => prev.map(g => g.id === game.id ? { ...g, filmTracks: next } : g))
    return true
  }

  const commitTrackDraft = async () => {
    if (!trackDraft) return
    const name = trackDraft.name.trim()
    if (!name) { setTrackDraft(null); return }
    if (trackDraft.id) {
      if (await saveTracks(angleTracks.map(t => t.id === trackDraft.id ? { ...t, name } : t))) setTrackDraft(null)
    } else {
      const track = { id: crypto.randomUUID(), name }
      if (await saveTracks([...angleTracks, track])) {
        setTrackDraft(null)
        setSelectedTrackId(track.id)
      }
    }
  }

  const deleteTrack = async (track: FilmTrack) => {
    if (orderedClips.some(c => trackIdOf(c) === track.id)) return
    if (await saveTracks(angleTracks.filter(t => t.id !== track.id))) setSelectedTrackId(MAIN_TRACK_ID)
  }

  const isAngle = selectedTrack.id !== MAIN_TRACK_ID
  const syncedCount = trackClips.filter(c => (c.syncPoints ?? []).some(p => p.kind === "sync")).length
  const hasMainFilm = orderedClips.some(c => c.status === "READY" && trackIdOf(c) === MAIN_TRACK_ID)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="text-xs text-fg-muted uppercase tracking-widest mb-1 block">Event</label>
          <select
            value={selectedEventId ?? ""}
            onChange={e => setSelectedEventId(e.target.value || null)}
            className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-border-strong"
          >
            <option value="">Select event…</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.title}</option>
            ))}
          </select>
        </div>

        {games.length > 0 && (
          <div className="flex-1">
            <label className="text-xs text-fg-muted uppercase tracking-widest mb-1 block">Game</label>
            <select
              value={selectedGameId ?? ""}
              onChange={e => { setSelectedGameId(e.target.value || null); setSelectedTrackId(MAIN_TRACK_ID) }}
              className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-border-strong"
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
            <h3 className="text-sm font-semibold text-fg-secondary">Film</h3>
            {hasMainFilm && (
              <Button size="sm" variant="outline" onClick={() => openGameViewer()}>
                Watch film
              </Button>
            )}
          </div>

          {/* Camera angles */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {tracks.map(track => {
                const count = orderedClips.filter(c => trackIdOf(c) === track.id).length
                const active = track.id === selectedTrack.id
                if (trackDraft?.id === track.id) {
                  return (
                    <input
                      key={track.id}
                      autoFocus
                      value={trackDraft.name}
                      onChange={e => setTrackDraft({ ...trackDraft, name: e.target.value })}
                      onKeyDown={e => { if (e.key === "Enter") commitTrackDraft(); if (e.key === "Escape") setTrackDraft(null) }}
                      onBlur={commitTrackDraft}
                      className="w-32 bg-surface border border-border-strong rounded-md px-2 py-1 text-xs text-foreground"
                    />
                  )
                }
                return (
                  <div key={track.id} className={`group flex items-center rounded-md border text-xs transition-colors ${active ? "border-border-strong bg-surface-2 text-foreground" : "border-border text-fg-muted hover:text-foreground"}`}>
                    <button onClick={() => setSelectedTrackId(track.id)} className="px-2.5 py-1">
                      {track.name} <span className="text-fg-muted font-mono">{count}</span>
                    </button>
                    {track.id !== MAIN_TRACK_ID && active && (
                      <>
                        <button
                          onClick={() => setTrackDraft({ id: track.id, name: track.name })}
                          className="pr-1 text-fg-muted hover:text-foreground"
                          aria-label={`Rename ${track.name}`}
                        >
                          <Pencil size={11} />
                        </button>
                        {count === 0 && (
                          <button onClick={() => deleteTrack(track)} className="pr-1.5 text-fg-muted hover:text-destructive" aria-label={`Delete ${track.name}`}>
                            <X size={12} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
              {trackDraft?.id === null ? (
                <input
                  autoFocus
                  placeholder="Angle name…"
                  value={trackDraft.name}
                  onChange={e => setTrackDraft({ id: null, name: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter") commitTrackDraft(); if (e.key === "Escape") setTrackDraft(null) }}
                  onBlur={commitTrackDraft}
                  className="w-32 bg-surface border border-border-strong rounded-md px-2 py-1 text-xs text-foreground placeholder:text-fg-faint"
                />
              ) : (
                <button
                  onClick={() => setTrackDraft({ id: null, name: "" })}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-xs text-fg-muted hover:text-foreground hover:border-border-strong transition-colors"
                >
                  <Plus size={12} /> Angle
                </button>
              )}
            </div>
            {trackError && <p className="text-xs text-destructive/80">{trackError}</p>}
            {isAngle ? (
              <div className="flex items-center gap-3 text-[11px] text-fg-muted">
                <span>
                  {trackClips.length === 0
                    ? "Add this angle's footage, then sync it to the main film."
                    : `${syncedCount} of ${trackClips.length} clip${trackClips.length === 1 ? "" : "s"} synced to Main`}
                </span>
                {trackClips.length > 0 && hasMainFilm && (
                  <Button size="sm" variant="outline" onClick={() => openGameViewer(selectedTrack.id)}>
                    Sync angle
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-fg-muted">Main is the reference film — points, notes and events are timed against it.</p>
            )}
          </div>

          {trackClips.length > 1 && (
            <p className="text-[11px] text-fg-faint -mt-2">Drag to reorder clips — sets playback order in the viewer</p>
          )}

          {loading ? (
            <Spinner size="sm" />
          ) : trackClips.length === 0 ? (
            <p className="text-fg-muted text-sm">No clips on {selectedTrack.name} yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {trackClips.map(clip => {
                const isDragging = dragId === clip.id
                const isDropTarget = dropId === clip.id && dragId !== null && dragId !== clip.id
                const synced = (clip.syncPoints ?? []).some(p => p.kind === "sync")

                return (
                  <div
                    key={clip.id}
                    draggable
                    onDragStart={() => setDragId(clip.id)}
                    onDragOver={e => { e.preventDefault(); setDropId(clip.id) }}
                    onDrop={() => handleDrop(clip.id)}
                    onDragEnd={() => { setDragId(null); setDropId(null) }}
                    className={`flex flex-col gap-1.5 px-4 py-3 rounded-xl border transition-colors group cursor-grab active:cursor-grabbing ${
                      isDragging
                        ? "opacity-40 border-border"
                        : isDropTarget
                        ? "border-border-strong bg-surface"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-fg-faint text-xs select-none shrink-0">⠿</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{clip.title ?? "Game Film"}</p>
                        {clip.durationSeconds && (
                          <p className="text-xs text-fg-muted font-mono">
                            {Math.floor(clip.durationSeconds / 60)}:{String(Math.round(clip.durationSeconds % 60)).padStart(2, "0")}
                          </p>
                        )}
                      </div>
                      {isAngle && (
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-md border ${synced ? "border-success/30 text-success/80" : "border-warning/30 text-warning/80"}`}>
                          {synced ? "Synced" : "Not synced"}
                        </span>
                      )}
                      <button
                        onClick={() => setPendingDelete(clip)}
                        className="text-fg-muted hover:text-destructive transition-all text-xs p-1 opacity-0 group-hover:opacity-100"
                        aria-label="Delete clip"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* YouTube import */}
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            <p className="text-xs text-fg-muted uppercase tracking-widest">Import from YouTube to {selectedTrack.name}</p>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="Paste YouTube URL…"
                value={importUrl}
                onChange={e => { setImportUrl(e.target.value); setImportError(null) }}
                onKeyDown={e => { if (e.key === "Enter") handleImport() }}
                className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-fg-faint focus:border-border-strong"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!importUrl.trim() || importing}
                onClick={handleImport}
              >
                {importing ? "Importing…" : "Import"}
              </Button>
            </div>
            {importError && (
              <p className="text-xs text-destructive/80">{importError}</p>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => { if (!open && !deleting) setPendingDelete(null) }}
        title="Delete film?"
        description={`"${pendingDelete?.title ?? "Game Film"}" will be removed from this game. This can't be undone.`}
        confirmLabel="Delete film"
        isLoading={deleting}
        onConfirm={confirmDelete}
      />
      {viewerData && (
        <FilmOverlay
          onClose={() => setViewerData(null)}
          title={game ? `vs ${game.opponent}${game.round ? ` · ${game.round}` : ""}` : undefined}
          gameId={viewerData.clips[0]?.gameId}
          subtitle={events.find(e => e.id === selectedEventId)?.title}
        >
          <FilmViewer
            clips={viewerData.clips}
            initialAnnotations={viewerData.annotations}
            canAnnotate
            initialSyncTrackId={viewerData.syncTrackId}
          />
        </FilmOverlay>
      )}
    </div>
  )
}
