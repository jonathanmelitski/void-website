"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

type NewsletterRow = {
  id: string
  title: string
  date: string
  published: boolean
}

export function NewslettersPanel() {
  const { user } = useAuth()
  const router = useRouter()
  const [newsletters, setNewsletters] = useState<NewsletterRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<NewsletterRow[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const isAdmin = user?.groups.includes("ADMIN") ?? false

  useEffect(() => {
    fetch("/api/newsletters?all=true")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setNewsletters(data)
        else setError(data.error ?? "Failed to load newsletters")
      })
      .catch(() => setError("Failed to load newsletters"))
      .finally(() => setIsLoading(false))
  }, [])

  function onNewsletterCreated(newsletter: NewsletterRow) {
    setNewsletters(prev => [newsletter, ...prev])
    setOpen(false)
  }

  async function handleTogglePublished(row: NewsletterRow) {
    setTogglingId(row.id)
    try {
      const res = await fetch(`/api/newsletters/${row.id}`, { method: "PATCH" })
      if (res.ok) {
        const updated = await res.json()
        setNewsletters(prev =>
          prev.map(n => (n.id === updated.id ? { ...n, published: updated.published } : n))
        )
      }
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(targets: NewsletterRow[], clearSelection: () => void) {
    setIsDeleting(true)
    try {
      await Promise.all(targets.map(n => fetch(`/api/newsletters/${n.id}`, { method: "DELETE" })))
      const deletedIds = new Set(targets.map(n => n.id))
      setNewsletters(prev => prev.filter(n => !deletedIds.has(n.id)))
      clearSelection()
    } catch {
      setError("Failed to delete newsletter(s)")
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  const clearFnRef = useRef<() => void>(() => {})

  function buildColumns(openConfirm: (row: NewsletterRow) => void): ColumnDef<NewsletterRow>[] {
    return [
      { header: "Title", accessorKey: "title" },
      { header: "Date", accessorKey: "date" },
      {
        header: "Status",
        cell: row => (
          <Badge variant={row.published ? "default" : "outline"}>
            {row.published ? "Published" : "Draft"}
          </Badge>
        ),
      },
      {
        header: "Actions",
        cell: row => (
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/live/manage/newsletters/${row.id}`)}
              className="text-white/50 hover:text-white text-sm underline underline-offset-2"
            >
              Manage
            </button>
            <button
              onClick={() => handleTogglePublished(row)}
              disabled={togglingId === row.id}
              className="text-white/50 hover:text-white text-sm transition-colors"
            >
              {row.published ? "Unpublish" : "Publish"}
            </button>
            {isAdmin && (
              <button
                onClick={() => openConfirm(row)}
                className="text-red-400/60 hover:text-red-400 text-sm transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        ),
      },
    ]
  }

  return (
    <div className="flex flex-col gap-4 text-left">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Newsletters</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">New Newsletter</Button>
          </DialogTrigger>
          <DialogContent className="bg-black border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle>Create Newsletter</DialogTitle>
            </DialogHeader>
            <CreateNewsletterForm onCreated={onNewsletterCreated} />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <DataTable
        columns={buildColumns(row => setDeleteTarget([row]))}
        data={newsletters}
        isLoading={isLoading}
        emptyMessage="No newsletters yet."
        getRowKey={n => n.id}
        toolbar={(selectedRows, clearSelection) => {
          clearFnRef.current = clearSelection
          if (selectedRows.length === 0 || !isAdmin) return null
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
        title={`Delete ${deleteTarget && deleteTarget.length > 1 ? `${deleteTarget.length} newsletters` : "newsletter"}?`}
        description="This action cannot be undone."
        isLoading={isDeleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget, clearFnRef.current)}
      />
    </div>
  )
}

function CreateNewsletterForm({
  onCreated,
}: {
  onCreated: (newsletter: NewsletterRow) => void
}) {
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [date, setDate] = useState("")
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  function handleTitleChange(value: string) {
    setTitle(value)
    setSlug(value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      // Create the newsletter first to get an ID
      const res = await fetch("/api/newsletters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date, slug }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to create newsletter"); return }

      let coverPhotoKey: string | undefined

      if (coverFile) {
        const presignRes = await fetch("/api/upload/newsletter-cover-presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newsletterId: data.id, contentType: coverFile.type }),
        })
        if (!presignRes.ok) {
          const d = await presignRes.json()
          setError(d.error ?? "Failed to get upload URL")
          return
        }
        const { url, key } = await presignRes.json()
        const uploadRes = await fetch(url, {
          method: "PUT",
          body: coverFile,
          headers: { "Content-Type": coverFile.type },
        })
        if (!uploadRes.ok) { setError("Cover photo upload failed"); return }
        coverPhotoKey = key
      }

      onCreated({ id: data.id, title, date, published: false })
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
        <Input
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder="March 2026 Newsletter"
          required
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Slug</Label>
        <Input
          value={slug}
          onChange={e => setSlug(e.target.value)}
          placeholder="march-2026-newsletter"
          required
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20 font-mono text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Date</Label>
        <Input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          required
          className="bg-white/5 border-white/10 text-white"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Cover photo (optional)</Label>
        <input
          type="file"
          accept="image/*"
          onChange={e => setCoverFile(e.target.files?.[0] ?? null)}
          className="text-sm text-white/60 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-white/20"
        />
      </div>
      <Button type="submit" disabled={isLoading} className="w-fit mt-1">
        {isLoading ? "Creating…" : "Create newsletter"}
      </Button>
    </form>
  )
}
