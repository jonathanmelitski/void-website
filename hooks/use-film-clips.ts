"use client"

import { useState, useCallback, useEffect } from "react"
import type { FilmClipItem } from "@/lib/aws/film-clips"

const NO_CLIPS: FilmClipItem[] = []

export function useFilmClips(gameId: string | null) {
  const [clips, setClips] = useState<FilmClipItem[]>([])
  const [loadedGameId, setLoadedGameId] = useState<string | null>(null)
  const loading = gameId !== null && loadedGameId !== gameId

  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    fetch(`/api/film/clips?gameId=${gameId}`)
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
      .then((data: FilmClipItem[]) => {
        if (cancelled) return
        setClips(Array.isArray(data) ? data : [])
        setLoadedGameId(gameId)
      })
    return () => { cancelled = true }
  }, [gameId])

  const deleteClip = useCallback(async (clipId: string) => {
    await fetch(`/api/film/clips/${clipId}`, { method: "DELETE" })
    setClips(prev => prev.filter(c => c.id !== clipId))
  }, [])

  const importYoutube = useCallback(async (youtubeUrl: string, trackId?: string) => {
    if (!gameId) return
    const sortOrder = clips.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1
    const res = await fetch("/api/film/clips/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, youtubeUrl, sortOrder, ...(trackId ? { trackId } : {}) }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error ?? "Import failed")
    }
    const clip: FilmClipItem = await res.json()
    setClips(prev => [...prev, clip])
  }, [gameId, clips])

  return { clips: gameId ? clips : NO_CLIPS, loading, importYoutube, deleteClip }
}
