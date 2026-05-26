"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import dynamic from "next/dynamic"
import type { PlayerItem } from "@/lib/aws/players"
import type { FilmClipItem } from "@/lib/aws/film-clips"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"

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
}

export default function MePage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [player, setPlayer] = useState<PlayerItem | null>(null)
  const [cognitoSub, setCognitoSub] = useState<string | null>(null)
  const [linked, setLinked] = useState<boolean | null>(null)

  const [gameClips, setGameClips] = useState<GameClips[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [viewerState, setViewerState] = useState<{ clips: FilmClipItem[]; annotations: FilmAnnotationItem[] } | null>(null)

  useEffect(() => {
    if (!isLoading && !user) router.replace("/live/login")
  }, [user, isLoading, router])

  useEffect(() => {
    if (!user) return
    async function load() {
      setDataLoading(true)
      const res = await fetch("/api/me/player")
      if (!res.ok) { setDataLoading(false); return }

      const { player: p, link, cognitoSub: sub } = await res.json()
      setCognitoSub(sub ?? null)
      if (!link) { setLinked(false); setDataLoading(false); return }

      setLinked(true)
      setPlayer(p)

      // Get all points for this player — scan VoidPoints with contains filter
      const pointsRes = await fetch(`/api/points?playerId=${p.id}`)
      const allPoints: PointSummary[] = pointsRes.ok ? await pointsRes.json() : []

      // Group by game
      const byGame = new Map<string, PointSummary[]>()
      for (const pt of allPoints) {
        if (!byGame.has(pt.gameId)) byGame.set(pt.gameId, [])
        byGame.get(pt.gameId)!.push(pt)
      }

      // Fetch games and clips in parallel
      const gameIds = [...byGame.keys()]
      const results = await Promise.all(
        gameIds.map(async gameId => {
          const [gameRes, clipsRes] = await Promise.all([
            fetch(`/api/games/${gameId}`),
            fetch(`/api/film/clips?gameId=${gameId}`),
          ])
          const game = gameRes.ok ? await gameRes.json() : null
          const clips: FilmClipItem[] = clipsRes.ok ? await clipsRes.json() : []
          return {
            gameId,
            gameLabel: game ? `vs ${game.opponent}${game.round ? ` · ${game.round}` : ""}` : gameId,
            clips: clips.filter((c: FilmClipItem) => c.status === "READY"),
            points: byGame.get(gameId) ?? [],
          }
        })
      )

      setGameClips(results.filter(g => g.clips.length > 0))
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
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  if (viewerState) {
    return (
      <div className="flex flex-col p-8 lg:px-16 gap-6">
        <button
          onClick={() => setViewerState(null)}
          className="text-white/40 hover:text-white/70 text-sm flex items-center gap-1 transition-colors w-fit"
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
          className="text-white/40 hover:text-white/70 text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-4xl font-black">My Footage</h1>
        {player && (
          <p className="text-white/50 mt-1 text-sm">
            #{player.number} {player.first_name} {player.last_name}
          </p>
        )}
      </div>

      {dataLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      {!dataLoading && linked === false && (
        <div className="flex flex-col gap-3 py-8">
          <p className="text-white/50 text-sm">Your account isn&apos;t linked to a player yet. Share your account ID with a coach to get linked.</p>
          <div className="flex items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-xl">
            <div>
              <p className="text-xs text-white/40 uppercase tracking-widest mb-1">Your Account ID</p>
              <p className="font-mono text-sm text-white/80 break-all">{cognitoSub ?? "Loading…"}</p>
            </div>
          </div>
        </div>
      )}

      {!dataLoading && linked && gameClips.length === 0 && (
        <p className="text-white/30 text-sm py-8">No film available for your games yet.</p>
      )}

      {!dataLoading && linked && gameClips.map(gc => (
        <section key={gc.gameId} className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">{gc.gameLabel}</h2>
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/40 uppercase tracking-widest">
              {gc.points.length} point{gc.points.length !== 1 ? "s" : ""} played
              {" · "}
              {gc.clips.length} clip{gc.clips.length !== 1 ? "s" : ""}
            </p>
            <button
              onClick={() => openGameViewer(gc.clips)}
              className="text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              Watch Game Film →
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
