"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { apiFetch } from "@/lib/api-fetch"
import { toast } from "@/components/ui/sonner"
import { CONNECTION_HINT, deleteMany, friendlyError } from "./api-helpers"
import { FormFooter } from "./form-footer"

type EventRow = {
  id: string
  title: string
  date: string
  location?: string
  isPrivate?: boolean
  allowedUsers?: string[]
}

export function EventsPanel() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<EventRow[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Edit privacy state
  const [editTarget, setEditTarget] = useState<EventRow | null>(null)

  useEffect(() => {
    apiFetch("/api/events")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setEvents(data); else setError("Couldn't load events. Reload to try again.") })
      .catch(() => setError(`Couldn't load events. ${CONNECTION_HINT}`))
      .finally(() => setIsLoading(false))
  }, [])

  function onEventCreated(event: EventRow) {
    setEvents(prev => [event, ...prev])
    setOpen(false)
    toast.success("Event created")
  }

  function onEventUpdated(updated: EventRow) {
    setEvents(prev => prev.map(e => e.id === updated.id ? { ...e, ...updated } : e))
    setEditTarget(null)
    toast.success("Privacy settings saved")
  }

  async function handleDelete(targets: EventRow[]) {
    setIsDeleting(true)
    const deleted = await deleteMany(
      targets,
      e => apiFetch(`/api/events/${e.id}`, { method: "DELETE", waitForSession: true }),
      { one: "event", many: "events" },
    )
    const deletedIds = new Set(deleted.map(e => e.id))
    if (deletedIds.size > 0) setEvents(prev => prev.filter(e => !deletedIds.has(e.id)))
    setIsDeleting(false)
    setDeleteTarget(null)
  }

  const columns: ColumnDef<EventRow>[] = [
    { header: "Title", accessorKey: "title" },
    { header: "Date", accessorKey: "date" },
    { header: "Location", cell: row => row.location || "—" },
    {
      header: "Visibility",
      cell: row => <VisibilityBadge row={row} />,
    },
    {
      header: "Actions",
      cell: row => (
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/gallery/${row.id}`}>View in gallery</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditTarget(row)}>Privacy</Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget([row])}>
            Delete
          </Button>
        </div>
      ),
    },
  ]

  const clearFnRef = useRef<(() => void)>(() => {})

  return (
    <div className="flex flex-col gap-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Events</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-10 sm:h-8">New event</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New event</DialogTitle>
            </DialogHeader>
            <CreateEventForm onCreated={onEventCreated} />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DataTable
        columns={columns}
        data={events}
        isLoading={isLoading}
        emptyMessage="No events yet. Create one to start adding games and photos."
        getRowKey={e => e.id}
        mobileCard={row => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.title}</p>
                <p className="truncate text-sm text-fg-muted">
                  {row.date}{row.location ? ` · ${row.location}` : ""}
                </p>
              </div>
              <VisibilityBadge row={row} />
            </div>
            <div className="-ml-3 flex flex-wrap items-center">
              <Button asChild variant="ghost" size="sm" className="h-10">
                <Link href={`/gallery/${row.id}`}>View in gallery</Link>
              </Button>
              <Button variant="ghost" size="sm" className="h-10" onClick={() => setEditTarget(row)}>Privacy</Button>
              <Button variant="ghost" size="sm" className="h-10 text-destructive hover:text-destructive" onClick={() => setDeleteTarget([row])}>
                Delete
              </Button>
            </div>
          </div>
        )}
        toolbar={(selectedRows, clearSelection) => {
          clearFnRef.current = clearSelection
          if (selectedRows.length === 0) return null
          return (
            <div className="flex items-center gap-3">
              <span className="text-sm text-fg-muted">{selectedRows.length} selected</span>
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
        onOpenChange={open => { if (!open && !isDeleting) setDeleteTarget(null) }}
        title={`Delete ${deleteTarget && deleteTarget.length > 1 ? `${deleteTarget.length} events` : "event"}?`}
        description={
          deleteTarget?.length === 1
            ? <>Delete <span className="font-medium text-foreground">{deleteTarget[0].title}</span>? This can&apos;t be undone.</>
            : "This can't be undone."
        }
        confirmLabel={deleteTarget && deleteTarget.length > 1 ? `Delete ${deleteTarget.length} events` : "Delete event"}
        isLoading={isDeleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
      />

      <Dialog open={editTarget !== null} onOpenChange={open => { if (!open) setEditTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Privacy settings</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <EditPrivacyForm event={editTarget} onUpdated={onEventUpdated} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function VisibilityBadge({ row }: { row: EventRow }) {
  return row.isPrivate
    ? <Badge variant="outline" className="shrink-0 text-warning border-warning/40">Private</Badge>
    : <span className="shrink-0 text-fg-muted text-sm">Public</span>
}

function parseEmails(text: string) {
  return text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
}

function PrivateToggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg-secondary">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="size-4 accent-foreground"
      />
      Private event
    </label>
  )
}

function CreateEventForm({ onCreated }: { onCreated: (event: EventRow) => void }) {
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [location, setLocation] = useState("")
  const [description, setDescription] = useState("")
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [isPrivate, setIsPrivate] = useState(false)
  const [allowedUsersText, setAllowedUsersText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; date?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof fieldErrors = {}
    if (!title.trim()) errs.title = "Enter a title."
    if (!date) errs.date = "Pick a date."
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return

    setError("")
    setIsLoading(true)
    try {
      let coverPhotoKey: string | undefined
      if (coverFile) {
        const tempId = `temp-${Date.now()}`
        const presignRes = await apiFetch("/api/upload/cover-presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: tempId, contentType: coverFile.type }),
          waitForSession: true,
        })
        if (!presignRes.ok) { setError(await friendlyError(presignRes, "Couldn't upload the cover photo. Try again.")); return }
        const { url, key } = await presignRes.json()
        const uploadRes = await fetch(url, { method: "PUT", body: coverFile, headers: { "Content-Type": coverFile.type } })
        if (!uploadRes.ok) { setError("Couldn't upload the cover photo. Try again or leave it out."); return }
        coverPhotoKey = key
      }

      const allowedUsers = isPrivate ? parseEmails(allowedUsersText) : []

      const res = await apiFetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date, location, description, coverPhotoKey, isPrivate, allowedUsers }),
        waitForSession: true,
      })
      if (!res.ok) { setError(await friendlyError(res, "Couldn't create the event. Try again.")); return }
      const data = await res.json()
      onCreated({ id: data.id, title, date, location, isPrivate, allowedUsers })
    } catch {
      setError(`Couldn't create the event. ${CONNECTION_HINT}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 pt-2">
      <Field label="Title" error={fieldErrors.title}>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Regionals 2026" />
      </Field>
      <Field label="Date" error={fieldErrors.date}>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <Field label="Location">
        <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="City, state" />
      </Field>
      <Field label="Description">
        <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Cover photo" hint="Optional">
        <input type="file" accept="image/*" onChange={e => setCoverFile(e.target.files?.[0] ?? null)}
          className="text-sm text-fg-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-sm file:text-foreground hover:file:bg-surface-3" />
      </Field>
      <PrivateToggle id="isPrivate" checked={isPrivate} onChange={setIsPrivate} />
      {isPrivate && (
        <Field label="Allowed users" hint="Emails, one per line or comma-separated">
          <Textarea
            value={allowedUsersText}
            onChange={e => setAllowedUsersText(e.target.value)}
            placeholder="name@example.com"
            rows={3}
            className="resize-none"
          />
        </Field>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <FormFooter submitLabel="Create event" isSubmitting={isLoading} />
    </form>
  )
}

function EditPrivacyForm({ event, onUpdated }: { event: EventRow; onUpdated: (updated: EventRow) => void }) {
  const [isPrivate, setIsPrivate] = useState(event.isPrivate ?? false)
  const [allowedUsersText, setAllowedUsersText] = useState(event.allowedUsers?.join("\n") ?? "")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      const allowedUsers = isPrivate ? parseEmails(allowedUsersText) : []
      const res = await apiFetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate, allowedUsers }),
        waitForSession: true,
      })
      if (!res.ok) { setError(await friendlyError(res, "Couldn't save privacy settings. Try again.")); return }
      onUpdated({ ...event, isPrivate, allowedUsers })
    } catch {
      setError(`Couldn't save privacy settings. ${CONNECTION_HINT}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 pt-2">
      <p className="text-sm text-fg-muted">{event.title}</p>
      <PrivateToggle id="editIsPrivate" checked={isPrivate} onChange={setIsPrivate} />
      {isPrivate && (
        <Field label="Allowed users" hint="Emails, one per line or comma-separated">
          <Textarea
            value={allowedUsersText}
            onChange={e => setAllowedUsersText(e.target.value)}
            placeholder="name@example.com"
            rows={4}
            className="resize-none"
          />
        </Field>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <FormFooter submitLabel="Save changes" isSubmitting={isLoading} />
    </form>
  )
}
