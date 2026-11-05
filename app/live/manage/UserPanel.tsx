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
        <Label className="text-fg-secondary">Event</Label>
        <select
          value={selectedEventId}
          onChange={e => setSelectedEventId(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground"
        >
          <option value="">— choose an event —</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-fg-secondary">Photo</Label>
        <input
          type="file"
          accept="image/*"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setStatus("idle"); setMessage("") }}
          className="text-sm text-fg-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-sm file:text-foreground hover:file:bg-surface-3"
        />
      </div>

      {status === "uploading" && <p className="text-sm text-fg-muted">Uploading…</p>}
      {status === "done" && <p className="text-sm text-success">{message}</p>}
      {status === "error" && <p className="text-sm text-destructive">{message}</p>}

      <Button onClick={handleUpload} disabled={status === "uploading" || !file || !selectedEventId} className="w-fit">
        Upload photo
      </Button>
    </div>
  )
}
