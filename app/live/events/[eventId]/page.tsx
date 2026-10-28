"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useAuth } from "@/lib/use-auth"
import { usePrefetchIntent } from "@/hooks/use-prefetch-intent"
import { useFilmClips } from "@/hooks/use-film-clips"
import type { GameItem } from "@/lib/aws/games"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"

const FilmViewer = dynamic(
  () => import("@/components/film/FilmViewer").then(m => m.FilmViewer),
  { ssr: false }
)

const RESULT_COLORS: Record<string, string> = {
  WIN: "text-green-400",
  LOSS: "text-red-400",
  TIE: "text-yellow-400",
}

function GameRow({ game, eventId }: { game: GameItem; eventId: string }) {
  const router = useRouter()
  const href = `/live/events/${eventId}/games/${game.id}`

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
      className="flex items-center gap-4 px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/3 transition-colors text-left group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">vs {game.opponent}</span>
          {game.round && <span className="text-white/30 text-xs">{game.round}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {game.status !== "SCHEDULED" && (
          <span className="font-mono text-sm">
            <span className={game.result === "WIN" ? "text-green-400" : game.result === "LOSS" ? "text-red-400" : ""}>{game.scoreVoid}</span>
            {" – "}
            <span className={game.result === "LOSS" ? "text-green-400" : game.result === "WIN" ? "text-red-400" : ""}>{game.scoreOpponent}</span>
          </span>
        )}
        {game.result && (
          <span className={`text-xs font-bold ${RESULT_COLORS[game.result] ?? ""}`}>{game.result}</span>
        )}
        {game.status === "SCHEDULED" && (
          <span className="text-white/30 text-xs">Scheduled</span>
        )}
        {game.status === "IN_PROGRESS" && (
          <span className="text-yellow-400/70 text-xs font-medium">Live</span>
        )}
      </div>
      <span className="text-white/20 group-hover:text-white/40 text-xs transition-colors">→</span>
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
    return <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin ml-1" />
  }

  const readyCount = clips.filter(c => c.status === "READY").length

  return (
    <div className="flex flex-col gap-2">
      {clips.length === 0 && !isCoachOrAdmin && (
        <p className="text-white/30 text-xs pl-1">No film for this game.</p>
      )}
      {readyCount > 0 && (
        <button
          onClick={handleWatchAll}
          className="text-xs text-white/50 hover:text-white/80 transition-colors text-left pl-1"
        >
          Watch Game Film → {readyCount > 1 ? `(${readyCount} clips)` : ""}
        </button>
      )}
      {clips.map(clip => (
        <div key={clip.id} className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border border-white/10 text-sm group">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-white/80 truncate">{clip.title ?? "Game Film"}</span>
            {isCoachOrAdmin && (
              <button
                onClick={() => { if (confirm(`Delete "${clip.title ?? "Game Film"}"?`)) deleteClip(clip.id) }}
                className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all text-xs p-1"
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
              className="flex-1 min-w-0 bg-transparent border border-dashed border-white/15 hover:border-white/30 focus:border-white/30 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline-none transition-colors"
            />
            {importUrl.trim() && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="text-xs text-white/50 hover:text-white transition-colors px-2 disabled:opacity-50"
              >
                {importing ? "Adding…" : "Add"}
              </button>
            )}
          </div>
          {importError && <p className="text-xs text-red-400/80 pl-1">{importError}</p>}
        </div>
      )}
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
    return <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin" />
  }

  if (games.length === 0) {
    return <p className="text-white/30 text-sm">No games logged for this event yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {games.map(game => (
        <div key={game.id} className="flex flex-col gap-2">
          <button
            onClick={() => toggle(game.id)}
            className="flex items-center gap-2 text-sm text-left group"
          >
            <span className="text-white/30 text-xs transition-transform" style={{ transform: expanded.has(game.id) ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            <span className="font-medium text-white/80 group-hover:text-white transition-colors">
              vs {game.opponent}
              {game.round && <span className="text-white/40 font-normal ml-1.5">{game.round}</span>}
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

  if (loading) return <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin" />

  if (games.length === 0) {
    return <p className="text-white/30 text-sm">No games logged for this event yet.</p>
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
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  if (eventLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="flex flex-col p-8 lg:px-16 gap-4">
        <button onClick={() => router.push("/live")} className="text-white/40 hover:text-white/70 text-sm flex items-center gap-1 transition-colors w-fit">
          ← Back
        </button>
        <p className="text-white/40 text-sm">{error || "Event not found."}</p>
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
          className="text-white/40 hover:text-white/70 text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-4xl font-black">{event.title}</h1>
        <p className="text-white/50 mt-1 text-sm">
          {dateLabel}{event.location ? ` · ${event.location}` : ""}
        </p>
        {event.description && (
          <p className="text-white/60 text-sm mt-2 max-w-prose">{event.description}</p>
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
              className="text-sm text-white/40 hover:text-white transition-colors"
            >
              View gallery →
            </Link>
          </div>
          <p className="text-white/30 text-sm">Photos uploaded for this event appear in the gallery.</p>
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
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
          <div className="flex items-center gap-4 px-6 py-4 border-b border-white/10">
            <button
              onClick={() => setFilmViewer(null)}
              className="text-white/40 hover:text-white/70 text-sm transition-colors"
            >
              ← Back
            </button>
            <span className="text-sm text-white/60">
              {filmViewer.clips.length > 1 ? `Game Film (${filmViewer.clips.length} clips)` : (filmViewer.clips[0]?.title ?? "Game Film")}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
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
