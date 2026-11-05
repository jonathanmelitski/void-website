"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useRequireAuth } from "@/hooks/use-require-auth"
import dynamic from "next/dynamic"
import type { PlayerItem } from "@/lib/aws/players"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"
import type { PlayerStats } from "@/lib/stats/derive"
import { Spinner } from "@/components/ui/spinner"
import { apiFetch } from "@/lib/api-fetch"

const FilmViewer = dynamic(
  () => import("@/components/film/FilmViewer").then(m => m.FilmViewer),
  { ssr: false }
)

interface PointSummary {
  id: string
  gameId: string
  pointNumber: number
  lineType: "O" | "D"
  outcome: string
}

interface GameClips {
  gameId: string
  gameLabel: string
  clips: FilmClipItem[]
  points: PointSummary[]
  stats: PlayerStats | null   // this player's derived stats for the game
}

export default function MePage() {
  const { user, isLoading } = useRequireAuth()
  const router = useRouter()
  const [player, setPlayer] = useState<PlayerItem | null>(null)
  const [cognitoSub, setCognitoSub] = useState<string | null>(null)
  const [linked, setLinked] = useState<boolean | null>(null)

  const [gameClips, setGameClips] = useState<GameClips[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [viewerState, setViewerState] = useState<{ clips: FilmClipItem[]; annotations: FilmAnnotationItem[] } | null>(null)

  useEffect(() => {
    if (!user) return
    async function load() {
      setDataLoading(true)
      // One request: player link, games with READY film, this player's points and derived stats
      // per game (server skips deleted games and private events the caller can't see).
      let res: Response
      try {
        res = await apiFetch("/api/me/footage")
      } catch {
        setDataLoading(false)
        return
      }
      if (!res.ok) { setDataLoading(false); return }

      const { player: p, link, cognitoSub: sub, games } = await res.json() as {
        player: PlayerItem | null
        link: unknown
        cognitoSub?: string
        games: GameClips[]
      }
      setCognitoSub(sub ?? null)
      if (!link) { setLinked(false); setDataLoading(false); return }

      setLinked(true)
      setPlayer(p)
      setGameClips(games.filter(g => g.clips.length > 0))
      setDataLoading(false)
    }

    load()
  }, [user])

  const openGameViewer = async (clips: FilmClipItem[]) => {
    const annArrays = await Promise.all(
      clips.map(c =>
        fetch(`/api/film/annotations?clipId=${c.id}`).then(r => r.ok ? r.json() : [])
      )
    )
    setViewerState({ clips, annotations: (annArrays as FilmAnnotationItem[][]).flat() })
  }

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh]">
        <Spinner size="md" />
      </div>
    )
  }

  if (viewerState) {
    return (
      <div className="flex flex-col p-8 lg:px-16 gap-6">
        <button
          onClick={() => setViewerState(null)}
          className="text-fg-muted hover:text-foreground text-sm flex items-center gap-1 transition-colors w-fit"
        >
          ← My Footage
        </button>
        <FilmViewer clips={viewerState.clips} initialAnnotations={viewerState.annotations} canAnnotate={false} />
      </div>
    )
  }

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8 text-left">
      <div>
        <button
          onClick={() => router.push("/live")}
          className="text-fg-muted hover:text-foreground text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-4xl font-display leading-none tracking-wide">My Footage</h1>
        {player && (
          <p className="text-fg-muted mt-1 text-sm">
            #{player.number} {player.first_name} {player.last_name}
          </p>
        )}
      </div>

      {dataLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      )}

      {!dataLoading && linked === false && (
        <div className="flex flex-col gap-3 py-8">
          <p className="text-fg-muted text-sm">Your account isn&apos;t linked to a player yet. Share your account ID with a coach to get linked.</p>
          <div className="flex items-center gap-3 p-4 bg-surface border border-border rounded-xl">
            <div>
              <p className="text-xs text-fg-muted uppercase tracking-widest mb-1">Your Account ID</p>
              <p className="font-mono text-sm text-foreground break-all">{cognitoSub ?? "Loading…"}</p>
            </div>
          </div>
        </div>
      )}

      {!dataLoading && linked && gameClips.length === 0 && (
        <p className="text-fg-muted text-sm py-8">No film available for your games yet.</p>
      )}

      {!dataLoading && linked && gameClips.map(gc => (
        <section key={gc.gameId} className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">{gc.gameLabel}</h2>
          <div className="flex items-center justify-between">
            <p className="text-xs text-fg-muted uppercase tracking-widest">
              {gc.points.length} point{gc.points.length !== 1 ? "s" : ""} played
              {" · "}
              {gc.clips.length} clip{gc.clips.length !== 1 ? "s" : ""}
              {gc.stats && ` · ${gc.stats.goals} G · ${gc.stats.assists} A · ${gc.stats.blocks} D · ${gc.stats.turnovers} T`}
            </p>
            <button
              onClick={() => openGameViewer(gc.clips)}
              className="text-xs text-fg-muted hover:text-foreground transition-colors"
            >
              Watch Game Film →
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
