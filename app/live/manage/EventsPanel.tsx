"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

type EventRow = { id: string; title: string; date: string; location?: string }

export function EventsPanel() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<EventRow[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    fetch("/api/events")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setEvents(data); else setError(data.error ?? "Failed to load events") })
      .catch(() => setError("Failed to load events"))
      .finally(() => setIsLoading(false))
  }, [])

  function onEventCreated(event: EventRow) {
    setEvents(prev => [event, ...prev])
    setOpen(false)
  }

  async function handleDelete(targets: EventRow[], clearSelection: () => void) {
    setIsDeleting(true)
    try {
      await Promise.all(targets.map(e => fetch(`/api/events/${e.id}`, { method: "DELETE" })))
      const deletedIds = new Set(targets.map(e => e.id))
      setEvents(prev => prev.filter(e => !deletedIds.has(e.id)))
      clearSelection()
    } catch {
      setError("Failed to delete event(s)")
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  function buildColumns(openConfirm: (row: EventRow) => void): ColumnDef<EventRow>[] {
    return [
      { header: "Title", accessorKey: "title" },
      { header: "Date", accessorKey: "date" },
      { header: "Location", cell: row => row.location ?? "—" },
      {
        header: "Actions",
        cell: row => (
          <div className="flex items-center gap-3">
            <Link href={`/gallery/${row.id}`} className="text-white/50 hover:text-white text-sm underline underline-offset-2">
              View in gallery
            </Link>
            <button
              onClick={() => openConfirm(row)}
              className="text-red-400/60 hover:text-red-400 text-sm transition-colors"
            >
              Delete
            </button>
          </div>
        ),
      },
    ]
  }

  // Capture clearSelection from DataTable toolbar callback
  const clearFnRef = useRef<(() => void)>(() => {})

  return (
    <div className="flex flex-col gap-4 text-left max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Events</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">New Event</Button>
          </DialogTrigger>
          <DialogContent className="bg-black border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle>Create Event</DialogTitle>
            </DialogHeader>
            <CreateEventForm onCreated={onEventCreated} />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <DataTable
        columns={buildColumns(row => setDeleteTarget([row]))}
        data={events}
        isLoading={isLoading}
        emptyMessage="No events yet."
        getRowKey={e => e.id}
        toolbar={(selectedRows, clearSelection) => {
          clearFnRef.current = clearSelection
          if (selectedRows.length === 0) return null
          return (
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/50">{selectedRows.length} selected</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteTarget(selectedRows)}
              >
                Delete
              </Button>
            </div>
          )
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title={`Delete ${deleteTarget && deleteTarget.length > 1 ? `${deleteTarget.length} events` : "event"}?`}
        description="This action cannot be undone."
        isLoading={isDeleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget, clearFnRef.current)}
      />
    </div>
  )
}

function CreateEventForm({ onCreated }: { onCreated: (event: EventRow) => void }) {
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [location, setLocation] = useState("")
  const [description, setDescription] = useState("")
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      let coverPhotoKey: string | undefined
      if (coverFile) {
        const tempId = `temp-${Date.now()}`
        const presignRes = await fetch("/api/upload/cover-presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: tempId, contentType: coverFile.type }),
        })
        if (!presignRes.ok) { const d = await presignRes.json(); setError(d.error ?? "Failed to get upload URL"); return }
        const { url, key } = await presignRes.json()
        const uploadRes = await fetch(url, { method: "PUT", body: coverFile, headers: { "Content-Type": coverFile.type } })
        if (!uploadRes.ok) { setError("Cover photo upload failed"); return }
        coverPhotoKey = key
      }

      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date, location, description, coverPhotoKey }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to create event"); return }
      onCreated({ id: data.id, title, date, location })
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Title</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Nationals 2025" required
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Date</Label>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} required
          className="bg-white/5 border-white/10 text-white" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Location</Label>
        <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Columbus, OH"
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Description</Label>
        <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Tournament description…"
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Cover photo</Label>
        <input type="file" accept="image/*" onChange={e => setCoverFile(e.target.files?.[0] ?? null)}
          className="text-sm text-white/60 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-white/20" />
      </div>
      <Button type="submit" disabled={isLoading} className="w-fit mt-1">
        {isLoading ? "Creating…" : "Create event"}
      </Button>
    </form>
  )
}
