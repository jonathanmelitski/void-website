"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { EventItem } from "@/lib/aws/dynamo"

export function UserPanel() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [selectedEventId, setSelectedEventId] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle")
  const [message, setMessage] = useState("")

  useEffect(() => {
    fetch("/api/events").then(r => r.json()).then(data => {
      if (Array.isArray(data)) setEvents(data)
    })
  }, [])

  async function handleUpload() {
    if (!file || !selectedEventId) { setMessage("Select an event and a photo first"); setStatus("error"); return }
    setStatus("uploading"); setMessage("")
    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: selectedEventId, filename: file.name, contentType: file.type }),
      })
      if (!presignRes.ok) { const d = await presignRes.json(); setMessage(d.error ?? "Failed to get upload URL"); setStatus("error"); return }
      const { url } = await presignRes.json()
      const uploadRes = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
      if (!uploadRes.ok) { setMessage("Upload failed"); setStatus("error"); return }
      setMessage("Photo uploaded successfully.")
      setStatus("done")
      setFile(null)
    } catch {
      setMessage("An unexpected error occurred")
      setStatus("error")
    }
  }

  return (
    <div className="flex flex-col gap-5 text-left">
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Event</Label>
        <select
          value={selectedEventId}
          onChange={e => setSelectedEventId(e.target.value)}
          className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white"
        >
          <option value="">— choose an event —</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Photo</Label>
        <input
          type="file"
          accept="image/*"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setStatus("idle"); setMessage("") }}
          className="text-sm text-white/60 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-white/20"
        />
      </div>

      {status === "uploading" && <p className="text-sm text-white/50">Uploading…</p>}
      {status === "done" && <p className="text-sm text-green-400">{message}</p>}
      {status === "error" && <p className="text-sm text-red-400">{message}</p>}

      <Button onClick={handleUpload} disabled={status === "uploading" || !file || !selectedEventId} className="w-fit">
        Upload photo
      </Button>
    </div>
  )
}
