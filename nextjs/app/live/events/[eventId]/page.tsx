"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/use-auth"
import type { GameItem } from "@/lib/aws/games"

const RESULT_COLORS: Record<string, string> = {
  WIN: "text-green-400",
  LOSS: "text-red-400",
  TIE: "text-yellow-400",
}

function GamesList({ eventId }: { eventId: string }) {
  const params = useParams<{ eventId: string }>()
  const router = useRouter()
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
        <button
          key={game.id}
          onClick={() => router.push(`/live/events/${eventId}/games/${game.id}`)}
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
          <p className="text-white/30 text-sm">Film review coming soon.</p>
        </section>
      </div>
    </div>
  )
}
