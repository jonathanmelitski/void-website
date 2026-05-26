"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import type { FilmClipItem } from "@/lib/aws/film-clips"

export type ClipPhase =
  | { tag: "uploading"; percent: number }
  | { tag: "transcoding" }
  | { tag: "ready" }
  | { tag: "interrupted" }
  | { tag: "error"; message?: string }

export function useFilmClips(gameId: string | null) {
  const [clips, setClips] = useState<FilmClipItem[]>([])
  const [phases, setPhases] = useState<Record<string, ClipPhase>>({})
  const [loading, setLoading] = useState(true)

  const pollTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const xhrsRef = useRef<Map<string, XMLHttpRequest>>(new Map())
  const pendingClipIds = useRef<Set<string>>(new Set())

  const setPhase = useCallback((clipId: string, phase: ClipPhase) => {
    setPhases(prev => ({ ...prev, [clipId]: phase }))
  }, [])

  const stopPolling = useCallback((clipId: string) => {
    if (pollTimers.current[clipId]) {
      clearTimeout(pollTimers.current[clipId])
      delete pollTimers.current[clipId]
    }
  }, [])

  const startPolling = useCallback((clipId: string) => {
    stopPolling(clipId)
    const tick = async () => {
      const res = await fetch(`/api/film/clips/${clipId}`)
      if (!res.ok) { pollTimers.current[clipId] = setTimeout(tick, 10_000); return }
      const updated: FilmClipItem = await res.json()
      setClips(prev => prev.map(c => c.id === clipId ? updated : c))
      if (updated.status === "READY") {
        setPhase(clipId, { tag: "ready" })
        stopPolling(clipId)
      } else if (updated.status === "ERROR") {
        setPhase(clipId, { tag: "error", message: updated.errorMessage })
        stopPolling(clipId)
      } else {
        pollTimers.current[clipId] = setTimeout(tick, 10_000)
      }
    }
    pollTimers.current[clipId] = setTimeout(tick, 10_000)
  }, [setPhase, stopPolling])

  useEffect(() => {
    if (!gameId) { setClips([]); setPhases({}); setLoading(false); return }

    setLoading(true)
    Object.keys(pollTimers.current).forEach(stopPolling)

    fetch(`/api/film/clips?gameId=${gameId}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: FilmClipItem[]) => {
        const list: FilmClipItem[] = Array.isArray(data) ? data : []
        setClips(list)

        const initial: Record<string, ClipPhase> = {}
        for (const clip of list) {
          if (clip.status === "READY") {
            initial[clip.id] = { tag: "ready" }
          } else if (clip.status === "TRANSCODING") {
            initial[clip.id] = { tag: "transcoding" }
            startPolling(clip.id)
          } else if (clip.status === "ERROR") {
            initial[clip.id] = { tag: "error", message: clip.errorMessage }
          } else {
            initial[clip.id] = { tag: "interrupted" }
          }
        }
        setPhases(initial)
      })
      .catch(() => { setClips([]); setPhases({}) })
      .finally(() => setLoading(false))

    return () => { Object.keys(pollTimers.current).forEach(stopPolling) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  const deleteClip = useCallback(async (clipId: string) => {
    await fetch(`/api/film/clips/${clipId}`, { method: "DELETE" })
    stopPolling(clipId)
    setPhases(prev => { const n = { ...prev }; delete n[clipId]; return n })
    setClips(prev => prev.filter(c => c.id !== clipId))
  }, [stopPolling])

  const cancelUpload = useCallback((clipId: string) => {
    const xhr = xhrsRef.current.get(clipId)
    if (xhr) { xhr.abort(); xhrsRef.current.delete(clipId) }
    pendingClipIds.current.delete(clipId)
    setPhases(prev => { const n = { ...prev }; delete n[clipId]; return n })
    setClips(prev => prev.filter(c => c.id !== clipId))
    fetch(`/api/film/clips/${clipId}`, { method: "DELETE" }).catch(() => {})
  }, [])

  const finishAndPoll = useCallback(async (clipId: string, youtubeVideoId: string) => {
    setPhase(clipId, { tag: "transcoding" })
    const patchRes = await fetch(`/api/film/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtubeVideoId }),
    })
    if (patchRes.ok) {
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: "TRANSCODING", youtubeVideoId } : c))
      startPolling(clipId)
    } else {
      setPhase(clipId, { tag: "interrupted" })
    }
  }, [setPhase, startPolling])

  const uploadOne = useCallback(async (file: File, sortOrder: number) => {
    if (!gameId) return
    let clipId: string | null = null
    try {
      // 1. Create clip record
      const clipRes = await fetch("/api/film/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          title: file.name.replace(/\.[^.]+$/, ""),
          sortOrder,
        }),
      })
      if (!clipRes.ok) throw new Error("Failed to create clip record")
      const clip: FilmClipItem = await clipRes.json()
      clipId = clip.id

      pendingClipIds.current.add(clip.id)
      setClips(prev => [...prev, clip])
      setPhase(clip.id, { tag: "uploading", percent: 0 })

      // 2. Upload via server proxy (server streams to YouTube, avoids CORS)
      const youtubeVideoId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrsRef.current.set(clip.id, xhr)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setPhase(clip.id, { tag: "uploading", percent: Math.round((e.loaded / e.total) * 100) })
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText)
              if (!data.youtubeVideoId) {
                reject(new Error(data.error ?? "Upload response missing video ID"))
                return
              }
              resolve(data.youtubeVideoId)
            } catch {
              reject(new Error(`Upload response parse failed (${xhr.status}): ${xhr.responseText.slice(0, 120)}`))
            }
          } else {
            try {
              const data = JSON.parse(xhr.responseText)
              reject(new Error(data.error ?? `Upload failed (${xhr.status})`))
            } catch {
              reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 120)}`))
            }
          }
        }
        xhr.onerror = () => reject(new Error("Upload failed"))
        xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"))
        xhr.open("POST", `/api/film/clips/${clip.id}/upload`)
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4")
        xhr.send(file)
      })

      xhrsRef.current.delete(clip.id)
      await finishAndPoll(clip.id, youtubeVideoId)

    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      // Unexpected failure — keep the clip so the session URL is preserved for resumption
      if (clipId) {
        xhrsRef.current.delete(clipId)
        setPhase(clipId, { tag: "interrupted" })
      }
    } finally {
      if (clipId) pendingClipIds.current.delete(clipId)
    }
  }, [gameId, setPhase, startPolling])

  const resumeUpload = useCallback(async (clipId: string, file: File) => {
    setPhase(clipId, { tag: "uploading", percent: 0 })
    try {
      // Ask the server how many bytes YouTube already has for this session
      const statusRes = await fetch(`/api/film/clips/${clipId}/upload`)
      const status = statusRes.ok ? await statusRes.json() : { bytesReceived: 0, sessionValid: false }

      // If upload somehow already completed server-side
      if (status.youtubeVideoId) {
        await finishAndPoll(clipId, status.youtubeVideoId)
        return
      }

      const offset: number = status.sessionValid ? (status.bytesReceived ?? 0) : 0
      const slice = offset > 0 ? file.slice(offset) : file

      const youtubeVideoId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrsRef.current.set(clipId, xhr)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const overall = Math.round(((offset + e.loaded) / file.size) * 100)
            setPhase(clipId, { tag: "uploading", percent: overall })
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText)
              if (!data.youtubeVideoId) { reject(new Error(data.error ?? "Upload response missing video ID")); return }
              resolve(data.youtubeVideoId)
            } catch {
              reject(new Error(`Upload response parse failed (${xhr.status}): ${xhr.responseText.slice(0, 120)}`))
            }
          } else {
            try { reject(new Error(JSON.parse(xhr.responseText).error ?? `Upload failed (${xhr.status})`)) }
            catch { reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 120)}`)) }
          }
        }
        xhr.onerror = () => reject(new Error("Upload failed"))
        xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"))
        xhr.open("POST", `/api/film/clips/${clipId}/upload`)
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4")
        if (offset > 0) {
          xhr.setRequestHeader("X-Upload-Offset", String(offset))
          xhr.setRequestHeader("X-Upload-Total", String(file.size))
        }
        xhr.send(slice)
      })

      xhrsRef.current.delete(clipId)
      await finishAndPoll(clipId, youtubeVideoId)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      xhrsRef.current.delete(clipId)
      setPhase(clipId, { tag: "interrupted" })
    }
  }, [setPhase, startPolling, finishAndPoll]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = useCallback((files: File[]) => {
    if (!gameId || files.length === 0) return
    const baseOrder = clips.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1
    files.forEach((file, i) => uploadOne(file, baseOrder + i))
  }, [gameId, clips, uploadOne])

  return { clips, phases, loading, upload, resumeUpload, cancelUpload, deleteClip }
}
