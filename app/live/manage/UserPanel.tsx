"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/native-select"
import { apiFetch } from "@/lib/api-fetch"
import { toast } from "@/components/ui/sonner"
import type { EventItem } from "@/lib/aws/dynamo"
import { CONNECTION_HINT, friendlyError } from "./api-helpers"

export function UserPanel() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [selectedEventId, setSelectedEventId] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle")
  const [message, setMessage] = useState("")

  useEffect(() => {
    apiFetch("/api/events").then(r => r.json()).then(data => {
      if (Array.isArray(data)) setEvents(data)
    }).catch(() => setMessage(`Couldn't load events. ${CONNECTION_HINT}`))
  }, [])

  async function handleUpload() {
    if (!file || !selectedEventId) { setMessage("Pick an event and a photo first."); setStatus("error"); return }
    setStatus("uploading"); setMessage("")
    try {
      const presignRes = await apiFetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: selectedEventId, filename: file.name, contentType: file.type }),
        waitForSession: true,
      })
      if (!presignRes.ok) { setMessage(await friendlyError(presignRes, "Couldn't start the upload. Try again.")); setStatus("error"); return }
      const { url } = await presignRes.json()
      const uploadRes = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
      if (!uploadRes.ok) { setMessage("The photo didn't upload. Try again."); setStatus("error"); return }
      toast.success("Photo uploaded")
      setStatus("idle")
      setFile(null)
      setFileKey(k => k + 1) // clear the file input
    } catch {
      setMessage(`The photo didn't upload. ${CONNECTION_HINT}`)
      setStatus("error")
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-5 text-left">
      <Field label="Event">
        <NativeSelect
          value={selectedEventId}
          onChange={e => setSelectedEventId(e.target.value)}
          className="[&>select]:h-10 sm:[&>select]:h-9"
        >
          <option value="">Choose an event</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </NativeSelect>
      </Field>

      <Field label="Photo">
        <input
          key={fileKey}
          type="file"
          accept="image/*"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setStatus("idle"); setMessage("") }}
          className="text-sm text-fg-secondary file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:text-sm file:text-foreground hover:file:bg-surface-3 sm:file:h-8"
        />
      </Field>

      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}

      <Button
        onClick={handleUpload}
        loading={status === "uploading"}
        disabled={!file || !selectedEventId}
        className="h-10 w-fit sm:h-9"
      >
        Upload photo
      </Button>
    </div>
  )
}
