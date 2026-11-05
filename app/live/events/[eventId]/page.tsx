"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useAuth } from "@/lib/use-auth"
import { usePrefetchIntent } from "@/hooks/use-prefetch-intent"
import { useFilmClips } from "@/hooks/use-film-clips"
import { useGameStats } from "@/hooks/use-game-stats"
import type { GameItem } from "@/lib/aws/games"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"
import { Spinner } from "@/components/ui/spinner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/components/ui/sonner"

const FilmViewer = dynamic(
  () => import("@/components/film/FilmViewer").then(m => m.FilmViewer),
  { ssr: false }
)

const RESULT_COLORS: Record<string, string> = {
  WIN: "text-success",
  LOSS: "text-destructive",
  TIE: "text-warning",
}

function GameRow({ game, eventId }: { game: GameItem; eventId: string }) {
  const router = useRouter()
  const href = `/live/events/${eventId}/games/${game.id}`
  // Score and W/L derived from the point record (film edits included); stored fields until it loads
  const stats = useGameStats(game.id)
  const scoreVoid = stats?.score.us ?? game.scoreVoid
  const scoreOpponent = stats?.score.them ?? game.scoreOpponent
  const result = stats ? stats.result : game.result
  const hasScoredPoints = !!stats?.points.some(p => p.scorer)

  const handleMouseEnter = useCallback(() => {
    router.prefetch(href)
    fetch(`/api/games/${game.id}`, { priority: "low" }).catch(() => {})
    fetch(`/api/points?gameId=${game.id}`, { priority: "low" }).catch(() => {})
    fetch(`/api/point-events?gameId=${game.id}`, { priority: "low" }).catch(() => {})
  }, [router, href, game.id])

  return (
    <button
      onClick={() => router.push(href)}
      onMouseEnter={handleMouseEnter}
      className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border hover:border-border-strong hover:bg-surface-2 transition-colors text-left group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">vs {game.opponent}</span>
          {game.round && <span className="text-fg-muted text-xs">{game.round}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {(game.status !== "SCHEDULED" || hasScoredPoints) && (
          <span className="font-mono text-sm">
            <span className={result === "WIN" ? "text-success" : result === "LOSS" ? "text-destructive" : ""}>{scoreVoid}</span>
            {" – "}
            <span className={result === "LOSS" ? "text-success" : result === "WIN" ? "text-destructive" : ""}>{scoreOpponent}</span>
          </span>
        )}
        {result && (
          <span className={`text-xs font-bold ${RESULT_COLORS[result] ?? ""}`}>{result}</span>
        )}
        {game.status === "SCHEDULED" && !hasScoredPoints && (
          <span className="text-fg-muted text-xs">Scheduled</span>
        )}
        {game.status === "IN_PROGRESS" && (
          <span className="text-warning/70 text-xs font-medium">Live</span>
        )}
      </div>
      <span className="text-fg-faint group-hover:text-foreground text-xs transition-colors">→</span>
    </button>
  )
}

function GameClipList({
  game,
  isCoachOrAdmin,
  onWatch,
}: {
  game: GameItem
  isCoachOrAdmin: boolean
  onWatch: (clips: FilmClipItem[], annotations: FilmAnnotationItem[]) => void
}) {
  const { clips, loading, importYoutube, deleteClip } = useFilmClips(game.id)
  const [importUrl, setImportUrl] = useState("")
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
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

  const handleWatchAll = async () => {
    const readyClips = clips.filter(c => c.status === "READY")
    if (readyClips.length === 0) return
    const annArrays = await Promise.all(
      readyClips.map(c =>
        fetch(`/api/film/annotations?clipId=${c.id}`).then(r => r.ok ? r.json() : [])
      )
    )
    onWatch(readyClips, (annArrays as FilmAnnotationItem[][]).flat())
  }

  const handleImport = async () => {
    if (!importUrl.trim()) return
    setImporting(true)
    setImportError(null)
    try {
      await importYoutube(importUrl.trim())
      setImportUrl("")
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed")
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return <Spinner size="xs" className="ml-1" />
  }

  const readyCount = clips.filter(c => c.status === "READY").length

  return (
    <div className="flex flex-col gap-2">
      {clips.length === 0 && !isCoachOrAdmin && (
        <p className="text-fg-muted text-xs pl-1">No film for this game.</p>
      )}
      {readyCount > 0 && (
        <button
          onClick={handleWatchAll}
          className="text-xs text-fg-muted hover:text-foreground transition-colors text-left pl-1"
        >
          Watch Game Film → {readyCount > 1 ? `(${readyCount} clips)` : ""}
        </button>
      )}
      {clips.map(clip => (
        <div key={clip.id} className="flex flex-col gap-1.5 px-3 py-2.5 rounded-md border border-border text-sm group">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-foreground truncate">{clip.title ?? "Game Film"}</span>
            {isCoachOrAdmin && (
              <button
                onClick={() => setPendingDelete(clip)}
                className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-destructive transition-all text-xs p-1"
                aria-label="Delete clip"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
      {isCoachOrAdmin && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="+ Add YouTube URL…"
              value={importUrl}
              onChange={e => { setImportUrl(e.target.value); setImportError(null) }}
              onKeyDown={e => { if (e.key === "Enter") handleImport() }}
              className="flex-1 min-w-0 bg-transparent border border-dashed border-border hover:border-border-strong focus:border-border-strong rounded-md px-3 py-2 text-xs text-foreground placeholder:text-fg-faint transition-colors"
            />
            {importUrl.trim() && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="text-xs text-fg-muted hover:text-foreground transition-colors px-2 disabled:opacity-50"
              >
                {importing ? "Adding…" : "Add"}
              </button>
            )}
          </div>
          {importError && <p className="text-xs text-destructive/80 pl-1">{importError}</p>}
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
    </div>
  )
}

function EventFilmSection({
  eventId,
  isCoachOrAdmin,
  onWatch,
}: {
  eventId: string
  isCoachOrAdmin: boolean
  onWatch: (clips: FilmClipItem[], annotations: FilmAnnotationItem[]) => void
}) {
  const [games, setGames] = useState<GameItem[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`/api/games?eventId=${eventId}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: GameItem[]) => {
        const sorted = Array.isArray(data)
          ? [...data].sort((a, b) => (a.scheduledTime && b.scheduledTime ? new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime() : 0))
          : []
        setGames(sorted)
      })
      .catch(() => setGames([]))
  }, [eventId])

  const toggle = (gameId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(gameId)) next.delete(gameId); else next.add(gameId)
      return next
    })
  }

  if (games === null) {
    return <Spinner size="sm" />
  }

  if (games.length === 0) {
    return <p className="text-fg-muted text-sm">No games logged for this event yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {games.map(game => (
        <div key={game.id} className="flex flex-col gap-2">
          <button
            onClick={() => toggle(game.id)}
            className="flex items-center gap-2 text-sm text-left group"
          >
            <span className="text-fg-muted text-xs transition-transform" style={{ transform: expanded.has(game.id) ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            <span className="font-medium text-foreground group-hover:text-foreground transition-colors">
              vs {game.opponent}
              {game.round && <span className="text-fg-muted font-normal ml-1.5">{game.round}</span>}
            </span>
          </button>
          {expanded.has(game.id) && (
            <div className="pl-5">
              <GameClipList game={game} isCoachOrAdmin={isCoachOrAdmin} onWatch={onWatch} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function GamesList({ eventId }: { eventId: string }) {
  const [games, setGames] = useState<GameItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/games?eventId=${eventId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setGames(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [eventId])

  if (loading) return <Spinner size="sm" />

  if (games.length === 0) {
    return <p className="text-fg-muted text-sm">No games logged for this event yet.</p>
  }

  const sorted = [...games].sort((a, b) => {
    if (a.scheduledTime && b.scheduledTime) return new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
    return 0
  })

  return (
    <div className="flex flex-col gap-2">
      {sorted.map(game => (
        <GameRow key={game.id} game={game} eventId={eventId} />
      ))}
    </div>
  )
}

interface EventItem {
  id: string
  title: string
  date: string
  location?: string
  description?: string
  coverPhotoKey?: string
  createdAt: string
}

export default function LiveEventPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { eventId } = useParams<{ eventId: string }>()
  const [event, setEvent] = useState<EventItem | null>(null)
  const [eventLoading, setEventLoading] = useState(true)
  const [error, setError] = useState("")
  const [filmViewer, setFilmViewer] = useState<{ clips: FilmClipItem[]; annotations: FilmAnnotationItem[] } | null>(null)
  const isCoachOrAdmin = !!(user?.groups?.includes("COACH") || user?.groups?.includes("ADMIN"))

  useEffect(() => {
    if (!isLoading && !user) router.replace("/live/login")
  }, [user, isLoading, router])

  useEffect(() => {
    if (!user) return
    fetch(`/api/events/${eventId}`)
      .then(res => {
        if (!res.ok) throw new Error("Not found")
        return res.json()
      })
      .then(setEvent)
      .catch(() => setError("Event not found."))
      .finally(() => setEventLoading(false))
  }, [user, eventId])

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh]">
        <Spinner size="md" />
      </div>
    )
  }

  if (eventLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh]">
        <Spinner size="md" />
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="flex flex-col p-8 lg:px-16 gap-4">
        <button onClick={() => router.push("/live")} className="text-fg-muted hover:text-foreground text-sm flex items-center gap-1 transition-colors w-fit">
          ← Back
        </button>
        <p className="text-fg-muted text-sm">{error || "Event not found."}</p>
      </div>
    )
  }

  const dateLabel = new Date(event.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8 text-left">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push("/live")}
          className="text-fg-muted hover:text-foreground text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-4xl font-display leading-none tracking-wide">{event.title}</h1>
        <p className="text-fg-muted mt-1 text-sm">
          {dateLabel}{event.location ? ` · ${event.location}` : ""}
        </p>
        {event.description && (
          <p className="text-fg-secondary text-sm mt-2 max-w-prose">{event.description}</p>
        )}
      </div>

      {/* Sections */}
      <div className="flex flex-col gap-10">
        {/* Photos */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Photos</h2>
            <Link
              href={`/gallery/${event.id}`}
              className="text-sm text-fg-muted hover:text-foreground transition-colors"
            >
              View gallery →
            </Link>
          </div>
          <p className="text-fg-muted text-sm">Photos uploaded for this event appear in the gallery.</p>
        </section>

        {/* Stats */}
        <section>
          <h2 className="text-lg font-bold mb-3">Stats</h2>
          <GamesList eventId={event.id} />
        </section>

        {/* Film */}
        <section>
          <h2 className="text-lg font-bold mb-3">Film</h2>
          <EventFilmSection
            eventId={event.id}
            isCoachOrAdmin={isCoachOrAdmin}
            onWatch={(clips, annotations) => setFilmViewer({ clips, annotations })}
          />
        </section>
      </div>

      {/* Film viewer overlay */}
      {filmViewer && (
        <div role="dialog" aria-modal="true" aria-label="Game film" className="fixed inset-0 z-50 bg-background flex flex-col">
          <div className="flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-border">
            <button
              onClick={() => setFilmViewer(null)}
              className="text-fg-muted hover:text-foreground text-sm transition-colors"
            >
              ← Back
            </button>
            <span className="text-sm text-fg-secondary">
              {filmViewer.clips.length > 1 ? `Game Film (${filmViewer.clips.length} clips)` : (filmViewer.clips[0]?.title ?? "Game Film")}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            <FilmViewer
              clips={filmViewer.clips}
              initialAnnotations={filmViewer.annotations}
              canAnnotate={isCoachOrAdmin}
            />
          </div>
        </div>
      )}
    </div>
  )
}
