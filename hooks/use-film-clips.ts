"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import type { FilmClipItem } from "@/lib/aws/film-clips"

export type ClipPhase =
  | { tag: "uploading"; percent: number }
  | { tag: "transcoding" }
  | { tag: "ready" }
  | { tag: "error"; message?: string; retryable?: boolean }

const PART_SIZE = 10 * 1024 * 1024 // 10 MB — each part well within the 1-hour presign expiry
const MAX_PART_RETRIES = 3

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export function useFilmClips(gameId: string | null) {
  const [clips, setClips] = useState<FilmClipItem[]>([])
  const [phases, setPhases] = useState<Record<string, ClipPhase>>({})
  const [loading, setLoading] = useState(true)

  const pollTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // One active XHR per clip (current in-flight part)
  const xhrsRef = useRef<Map<string, XMLHttpRequest>>(new Map())

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
    pollTimers.current[clipId] = setTimeout(tick, 3_000)
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
            // UPLOADING without active XHR — multipart is open in S3, user must re-select file
            initial[clip.id] = { tag: "error", message: "Upload interrupted — click Retry to re-upload", retryable: true }
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
    xhrsRef.current.get(clipId)?.abort()
    xhrsRef.current.delete(clipId)
    setPhases(prev => { const n = { ...prev }; delete n[clipId]; return n })
    setClips(prev => prev.filter(c => c.id !== clipId))
  }, [stopPolling])

  const cancelUpload = useCallback((clipId: string) => {
    xhrsRef.current.get(clipId)?.abort()
    xhrsRef.current.delete(clipId)
    setPhases(prev => { const n = { ...prev }; delete n[clipId]; return n })
    setClips(prev => prev.filter(c => c.id !== clipId))
    // Server DELETE aborts the multipart upload and removes the DB record
    fetch(`/api/film/clips/${clipId}`, { method: "DELETE" }).catch(() => {})
  }, [])

  // Core upload logic — shared by first upload and retry
  const runUpload = useCallback(async (clipId: string, file: File) => {
    try {
      // 1. Get multipart presigned URLs (server aborts any orphaned multipart from prior attempt)
      setPhase(clipId, { tag: "uploading", percent: 0 })
      const presignRes = await fetch(`/api/film/clips/${clipId}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type || "video/mp4", filename: file.name, fileSize: file.size }),
      })
      if (!presignRes.ok) throw new Error("Failed to start upload")
      const { uploadId, s3Key, parts } = await presignRes.json() as {
        uploadId: string
        s3Key: string
        parts: { partNumber: number; uploadUrl: string }[]
      }

      // 2. Upload each part with per-part retry
      let bytesUploaded = 0
      for (const { partNumber, uploadUrl } of parts) {
        const start = (partNumber - 1) * PART_SIZE
        const end = Math.min(start + PART_SIZE, file.size)
        const chunk = file.slice(start, end)
        let lastError: Error | null = null

        for (let attempt = 0; attempt < MAX_PART_RETRIES; attempt++) {
          if (attempt > 0) {
            await sleep(1000 * Math.pow(2, attempt - 1)) // 1s, 2s backoff
          }

          const bytesBeforeThisPart = bytesUploaded
          try {
            await new Promise<void>((resolve, reject) => {
              const xhr = new XMLHttpRequest()
              xhrsRef.current.set(clipId, xhr)
              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                  const totalNow = bytesBeforeThisPart + e.loaded
                  setPhase(clipId, { tag: "uploading", percent: Math.round((totalNow / file.size) * 100) })
                }
              }
              xhr.onload = () => {
                xhrsRef.current.delete(clipId)
                if (xhr.status >= 200 && xhr.status < 300) resolve()
                else reject(new Error(`Part ${partNumber} upload failed (${xhr.status})`))
              }
              xhr.onerror = () => { xhrsRef.current.delete(clipId); reject(new Error(`Part ${partNumber} network error`)) }
              xhr.onabort = () => { xhrsRef.current.delete(clipId); reject(new DOMException("Cancelled", "AbortError")) }
              xhr.open("PUT", uploadUrl)
              // Parts use application/octet-stream; Content-Type on the assembled object
              // is set by CreateMultipartUpload on the server.
              xhr.setRequestHeader("Content-Type", "application/octet-stream")
              xhr.send(chunk)
            })
            lastError = null
            break // part succeeded
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") throw err
            lastError = err instanceof Error ? err : new Error(String(err))
          }
        }

        if (lastError) throw lastError
        bytesUploaded += chunk.size
      }

      // 3. Assemble — server calls ListParts + CompleteMultipartUpload
      setPhase(clipId, { tag: "uploading", percent: 100 })
      const completeRes = await fetch(`/api/film/clips/${clipId}/complete-multipart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, s3Key }),
      })
      if (!completeRes.ok) throw new Error("Failed to finalize upload")

      // 4. Trigger MediaConvert transcoding
      setPhase(clipId, { tag: "transcoding" })
      const transcodeRes = await fetch(`/api/film/clips/${clipId}/transcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3RawKey: s3Key }),
      })
      if (!transcodeRes.ok) throw new Error("Failed to start transcoding")

      // 5. Poll until READY or ERROR
      startPolling(clipId)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setPhase(clipId, {
        tag: "error",
        message: err instanceof Error ? err.message : "Upload failed",
        retryable: true,
      })
    }
  }, [setPhase, startPolling])

  const uploadOne = useCallback(async (file: File, sortOrder: number) => {
    if (!gameId) return
    try {
      const clipRes = await fetch("/api/film/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, title: file.name.replace(/\.[^.]+$/, ""), sortOrder }),
      })
      if (!clipRes.ok) throw new Error("Failed to create clip record")
      const clip: FilmClipItem = await clipRes.json()
      setClips(prev => [...prev, clip])
      await runUpload(clip.id, file)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      // clip record may not have been created — nothing to show
    }
  }, [gameId, runUpload])

  const upload = useCallback((files: File[]) => {
    if (!gameId || files.length === 0) return
    const baseOrder = clips.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1
    files.forEach((file, i) => uploadOne(file, baseOrder + i))
  }, [gameId, clips, uploadOne])

  // Retry a failed upload — caller re-selects the file, server cleans up any orphaned multipart
  const retryUpload = useCallback(async (clipId: string, file: File) => {
    await runUpload(clipId, file)
  }, [runUpload])

  const importYoutube = useCallback(async (youtubeUrl: string) => {
    if (!gameId) return
    const sortOrder = clips.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1
    const res = await fetch("/api/film/clips/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, youtubeUrl, sortOrder }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error ?? "Import failed")
    }
    const clip: FilmClipItem = await res.json()
    setClips(prev => [...prev, clip])
    setPhase(clip.id, { tag: "ready" })
  }, [gameId, clips, setPhase])

  return { clips, phases, loading, upload, retryUpload, importYoutube, cancelUpload, deleteClip }
}
