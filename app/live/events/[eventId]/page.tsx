"use client"

import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { ChevronDown, ChevronLeft, Clapperboard, Lock, Radio, Trophy, X } from "lucide-react"
import { useAuth } from "@/lib/use-auth"
import { useRequireAuth } from "@/hooks/use-require-auth"
import { useFilmClips } from "@/hooks/use-film-clips"
import { useGameStats } from "@/hooks/use-game-stats"
import type { GameItem, GameResult } from "@/lib/aws/games"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"
import { formatEventDate, formatGameTime } from "@/lib/format-date"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer, PageHeader } from "@/components/ui/page"
import { PrefetchLink } from "@/components/prefetch-link"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/components/ui/sonner"

const FilmViewer = dynamic(
  () => import("@/components/film/FilmViewer").then(m => m.FilmViewer),
  { ssr: false }
)
const FilmOverlay = dynamic(
  () => import("@/components/film/FilmOverlay").then(m => m.FilmOverlay),
  { ssr: false }
)

type OnWatch = (clips: FilmClipItem[], annotations: FilmAnnotationItem[]) => void

const RESULT_BADGE: Record<GameResult, { label: string; variant: "success" | "destructive" | "warning" }> = {
  WIN: { label: "Win", variant: "success" },
  LOSS: { label: "Loss", variant: "destructive" },
  TIE: { label: "Tie", variant: "warning" },
}

function gameSortKey(g: GameItem) {
  return new Date(g.scheduledTime ?? g.createdAt).getTime() || 0
}

// Live games first, then by start time (falls back to when the game was created)
function sortGames(games: GameItem[]) {
  return [...games].sort((a, b) => {
    const live = Number(b.status === "IN_PROGRESS") - Number(a.status === "IN_PROGRESS")
    return live || gameSortKey(a) - gameSortKey(b)
  })
}

function LiveLabel() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full rounded-full bg-current opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-current" />
      </span>
      Live
    </span>
  )
}

function GameRow({ game, eventId, isCoachOrAdmin, onWatch }: {
  game: GameItem
  eventId: string
  isCoachOrAdmin: boolean
  onWatch: OnWatch
}) {
  const href = `/live/events/${eventId}/games/${game.id}`
  // Score and W/L derived from the point record (film edits included); stored fields until it loads
  const stats = useGameStats(game.id)
  const { clips, loading: clipsLoading, importYoutube, deleteClip } = useFilmClips(game.id)
  const [filmOpen, setFilmOpen] = useState(false)
  const [openingFilm, setOpeningFilm] = useState(false)

  const scoreVoid = stats?.score.us ?? game.scoreVoid
  const scoreOpponent = stats?.score.them ?? game.scoreOpponent
  const result = stats ? stats.result : game.result
  const hasScoredPoints = !!stats?.points.some(p => p.scorer)
  const isLive = game.status === "IN_PROGRESS"
  const notStarted = game.status === "SCHEDULED" && !hasScoredPoints
  const readyClips = clips.filter(c => c.status === "READY")
  const startTime = formatGameTime(game.scheduledTime)

  const handleWatchFilm = async () => {
    if (readyClips.length === 0) return
    setOpeningFilm(true)
    try {
      const annArrays = await Promise.all(
        readyClips.map(c =>
          fetch(`/api/film/annotations?clipId=${c.id}`).then(r => r.ok ? r.json() : []).catch(() => [])
        )
      )
      onWatch(readyClips, (annArrays as FilmAnnotationItem[][]).flat())
    } finally {
      setOpeningFilm(false)
    }
  }

  const meta = [game.round, notStarted ? startTime : null].filter(Boolean).join(" · ")

  return (
    <li className="rounded-xl border border-border transition-colors hover:border-border-strong">
      <div className="flex items-center gap-2 pr-2">
        <PrefetchLink
          href={href}
          apiPrefetchUrls={[`/api/games/${game.id}`, `/api/points?gameId=${game.id}`, `/api/point-events?gameId=${game.id}`]}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl py-3 pl-4 pr-2 hover:bg-surface-2"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-foreground">vs {game.opponent}</span>
            {meta && <span className="truncate text-xs text-fg-muted">{meta}</span>}
          </span>
          {isLive ? (
            <span className="flex shrink-0 items-center gap-3">
              <span className="font-mono tabular-nums text-sm text-foreground">{scoreVoid}–{scoreOpponent}</span>
              <LiveLabel />
            </span>
          ) : notStarted ? (
            <span className="shrink-0 text-xs text-fg-muted">Scheduled</span>
          ) : (
            <span className="flex shrink-0 items-center gap-2">
              <span className="w-12 text-right font-mono tabular-nums text-sm text-foreground">{scoreVoid}–{scoreOpponent}</span>
              {result && (
                <Badge variant={RESULT_BADGE[result].variant} className="w-10">{RESULT_BADGE[result].label}</Badge>
              )}
            </span>
          )}
        </PrefetchLink>

        {isLive && (
          <Button asChild variant="brand" size="sm" className="h-10">
            <Link href={`/live/watch/${game.id}`}>
              <Radio aria-hidden />
              <span className="sr-only sm:not-sr-only">Watch live</span>
            </Link>
          </Button>
        )}
        {/* Fixed-width slot so scores line up whether or not a game has film (clips load per row) */}
        <div className="flex w-10 shrink-0 sm:w-32">
          {readyClips.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-full"
              loading={openingFilm}
              onClick={handleWatchFilm}
              aria-label={readyClips.length > 1 ? `Watch film (${readyClips.length} angles)` : "Watch film"}
            >
              {!openingFilm && <Clapperboard aria-hidden />}
              <span className="hidden sm:inline">Watch film</span>
            </Button>
          )}
        </div>
        {isCoachOrAdmin && (
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => setFilmOpen(o => !o)}
            aria-expanded={filmOpen}
            aria-label={filmOpen ? "Hide film settings" : "Film settings"}
            disabled={clipsLoading}
          >
            <ChevronDown className={`transition-transform ${filmOpen ? "rotate-180" : ""}`} />
          </Button>
        )}
      </div>
      {isCoachOrAdmin && filmOpen && (
        <div className="border-t border-border px-4 py-3">
          <GameClipList clips={clips} importYoutube={importYoutube} deleteClip={deleteClip} />
        </div>
      )}
    </li>
  )
}

// Coach/admin film management for one game: list clips, add a YouTube link, delete a clip.
function GameClipList({ clips, importYoutube, deleteClip }: {
  clips: FilmClipItem[]
  importYoutube: (url: string) => Promise<void>
  deleteClip: (clipId: string) => Promise<void>
}) {
  const [importUrl, setImportUrl] = useState("")
  const [importing, setImporting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<FilmClipItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteClip(pendingDelete.id)
      toast.success("Film deleted")
      setPendingDelete(null)
    } catch {
      toast.error("Couldn't delete the film. Try again.")
    } finally {
      setDeleting(false)
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!importUrl.trim()) return
    setImporting(true)
    try {
      await importYoutube(importUrl.trim())
      setImportUrl("")
      toast.success("Film added")
    } catch {
      toast.error("Couldn't add that video. Check it's a YouTube link and try again.")
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {clips.length === 0 ? (
        <p className="text-xs text-fg-muted">No film for this game yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {clips.map(clip => (
            <li key={clip.id} className="flex min-h-10 items-center gap-3 rounded-md border border-border pl-3 pr-1 text-sm">
              <span className="flex-1 truncate text-foreground">{clip.title ?? "Game film"}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPendingDelete(clip)}
                className="text-fg-muted hover:text-destructive"
                aria-label={`Delete ${clip.title ?? "film"}`}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleImport} className="flex gap-2">
        <input
          type="url"
          placeholder="Add a YouTube link"
          aria-label="YouTube link"
          value={importUrl}
          onChange={e => setImportUrl(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-md border border-dashed border-border bg-transparent px-3 text-sm text-foreground placeholder:text-fg-muted hover:border-border-strong focus:border-border-strong"
        />
        <Button type="submit" variant="outline" className="h-10" loading={importing} disabled={!importUrl.trim()}>
          Add
        </Button>
      </form>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => { if (!open && !deleting) setPendingDelete(null) }}
        title="Delete film?"
        description={`"${pendingDelete?.title ?? "Game film"}" will be removed from this game. This can't be undone.`}
        confirmLabel="Delete film"
        isLoading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function GamesList({ games, eventId, isCoachOrAdmin, onWatch }: {
  games: GameItem[] | "error"
  eventId: string
  isCoachOrAdmin: boolean
  onWatch: OnWatch
}) {
  if (games === "error") {
    return <EmptyState icon={<Trophy />} title="Couldn't load games" description="Check your connection and reload the page." />
  }
  if (games.length === 0) {
    return (
      <EmptyState
        icon={<Trophy />}
        title="No games yet"
        description={isCoachOrAdmin ? "Add a game for this event in Manage." : "Games will show up here once a coach adds them."}
        action={isCoachOrAdmin ? <Button asChild size="sm" variant="outline"><Link href="/live/manage">Go to Manage</Link></Button> : undefined}
      />
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {sortGames(games).map(game => (
        <GameRow key={game.id} game={game} eventId={eventId} isCoachOrAdmin={isCoachOrAdmin} onWatch={onWatch} />
      ))}
    </ul>
  )
}

function EventSkeleton() {
  return (
    <PageContainer aria-busy aria-label="Loading event">
      <Skeleton className="mb-4 h-5 w-24" />
      <div className="mb-6 flex flex-col gap-3 md:mb-8">
        <Skeleton className="h-10 w-64 max-w-full md:h-12" />
        <Skeleton className="h-5 w-56 max-w-full" />
      </div>
      <Skeleton className="mb-3 h-6 w-20" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map(i => <SkeletonRow key={i} className="h-14" />)}
      </div>
    </PageContainer>
  )
}

interface EventItem {
  id: string
  title: string
  date: string
  location?: string
  description?: string
  coverPhotoKey?: string
  isPrivate?: boolean
  createdAt: string
}

export default function LiveEventPage() {
  const { user, isLoading } = useRequireAuth()
  const { status } = useAuth()
  const { eventId } = useParams<{ eventId: string }>()
  // The event (or null when not found) plus whether that request went out with a confirmed session
  const [eventResult, setEventResult] = useState<{ event: EventItem | null; authed: boolean } | null>(null)
  const requestedRef = useRef<{ eventId: string; authed: boolean } | null>(null)
  const [games, setGames] = useState<GameItem[] | "error" | null>(null)
  const [filmViewer, setFilmViewer] = useState<{ clips: FilmClipItem[]; annotations: FilmAnnotationItem[] } | null>(null)
  const isCoachOrAdmin = !!(user?.groups?.includes("COACH") || user?.groups?.includes("ADMIN"))

  // Event and games load alongside the auth check. The event API hides private events without a
  // session, so if the first try went out before sign-in was confirmed and failed, retry once after.
  useEffect(() => {
    const authed = status === "authenticated"
    const prev = requestedRef.current
    const firstTry = !prev || prev.eventId !== eventId
    const retry = !firstTry && authed && !prev.authed && eventResult !== null && eventResult.event === null
    if (!firstTry && !retry) return
    requestedRef.current = { eventId, authed }
    fetch(`/api/events/${eventId}`)
      .then(res => {
        if (!res.ok) throw new Error("Not found")
        return res.json()
      })
      .then((data: EventItem) => setEventResult({ event: data, authed }))
      .catch(() => setEventResult({ event: null, authed }))
  }, [status, eventId, eventResult])
  const event = eventResult?.event ?? null
  // A miss before sign-in was confirmed isn't final: it's retried once the session is known
  const eventPending = !eventResult || (!eventResult.event && !eventResult.authed && (status === "loading" || status === "authenticated"))

  useEffect(() => {
    fetch(`/api/games?eventId=${eventId}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(data => setGames(Array.isArray(data) ? data : []))
      .catch(() => setGames("error"))
  }, [eventId])

  useEffect(() => {
    if (event) document.title = `${event.title} · Void Live`
  }, [event])

  const backLink = (
    <Link href="/live" className="inline-flex min-h-10 items-center gap-1 text-sm text-fg-muted hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden />
      Void Live
    </Link>
  )

  // Render once the event and its games are both in, so the list doesn't push the page around.
  if (isLoading || !user || eventPending || (event && games === null)) {
    return <EventSkeleton />
  }

  if (!event) {
    return (
      <PageContainer>
        {backLink}
        <EmptyState
          variant="page"
          icon={<Trophy />}
          title="Event not found"
          description="It may have been removed, or you may not have access to it."
          action={<Button asChild size="sm" variant="outline"><Link href="/live">Back to events</Link></Button>}
        />
      </PageContainer>
    )
  }

  const dateLabel = formatEventDate(event.date)

  return (
    <PageContainer className="text-left">
      <PageHeader
        eyebrow={backLink}
        title={event.title}
        description={
          <span className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <span>{dateLabel}{event.location ? ` · ${event.location}` : ""}</span>
              {event.isPrivate && (
                <Badge variant="outline" className="text-fg-secondary"><Lock aria-hidden />Private</Badge>
              )}
            </span>
            {event.description && <span className="max-w-prose text-fg-secondary">{event.description}</span>}
          </span>
        }
      />

      <div className="flex flex-col gap-10">
        <section aria-labelledby="games-heading">
          <h2 id="games-heading" className="mb-3 text-lg font-semibold">Games</h2>
          <GamesList
            games={games ?? []}
            eventId={event.id}
            isCoachOrAdmin={isCoachOrAdmin}
            onWatch={(clips, annotations) => setFilmViewer({ clips, annotations })}
          />
        </section>

        <section aria-labelledby="photos-heading">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="photos-heading" className="text-lg font-semibold">Photos</h2>
            <Button asChild variant="ghost" size="sm" className="h-10">
              <Link href={`/gallery/${event.id}`}>View gallery</Link>
            </Button>
          </div>
          <p className="text-sm text-fg-muted">Photos for this event are in the gallery.</p>
        </section>
      </div>

      {/* Film viewer overlay */}
      {filmViewer && (
        <FilmOverlay onClose={() => setFilmViewer(null)} gameId={filmViewer.clips[0]?.gameId} subtitle={event.title}>
          <FilmViewer
            clips={filmViewer.clips}
            initialAnnotations={filmViewer.annotations}
            canAnnotate={isCoachOrAdmin}
          />
        </FilmOverlay>
      )}
    </PageContainer>
  )
}
