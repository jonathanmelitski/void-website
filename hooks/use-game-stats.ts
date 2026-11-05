"use client"

import { useEffect, useState } from "react"
import type { GameStats } from "@/lib/stats/derive"

// Derived stats for one game from GET /api/games/[id]/stats. Null until loaded or on failure,
// so callers fall back to the stored game fields.
export function useGameStats(gameId: string | null | undefined): GameStats | null {
  const [stats, setStats] = useState<GameStats | null>(null)
  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    fetch(`/api/games/${gameId}/stats`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: GameStats | null) => { if (!cancelled) setStats(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [gameId])
  return stats
}
