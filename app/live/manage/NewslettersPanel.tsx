"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
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
import { apiFetch } from "@/lib/api-fetch"
import { toast } from "@/components/ui/sonner"
import { NEWSLETTER_TEMPLATE, parseNewsletterTemplate } from "@/lib/newsletter-template"
import { CONNECTION_HINT, deleteMany, friendlyError } from "./api-helpers"
import { FormFooter } from "./form-footer"
import { IMAGE_ACCEPT, ImagePrepError, prepareImageForUpload, putToPresignedUrl } from "@/lib/image-prep"

type NewsletterRow = {
  id: string
  title: string
  date: string
  published: boolean
}

const slugify = (v: string) => v.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")

function StatusBadge({ row }: { row: NewsletterRow }) {
  return (
    <Badge variant={row.published ? "default" : "outline"} className="shrink-0">
      {row.published ? "Published" : "Draft"}
    </Badge>
  )
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
  const [duplicateTarget, setDuplicateTarget] = useState<NewsletterRow | null>(null)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const isAdmin = user?.groups.includes("ADMIN") ?? false

  useEffect(() => {
    apiFetch("/api/newsletters?all=true")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setNewsletters(data)
        else setError("Couldn't load newsletters. Reload to try again.")
      })
      .catch(() => setError(`Couldn't load newsletters. ${CONNECTION_HINT}`))
      .finally(() => setIsLoading(false))
  }, [])

  function onNewsletterCreated(newsletter: NewsletterRow) {
    setNewsletters(prev => [newsletter, ...prev])
    setOpen(false)
    toast.success("Newsletter created")
  }

  async function handleTogglePublished(row: NewsletterRow) {
    setTogglingId(row.id)
    const action = row.published ? "unpublish" : "publish"
    try {
      const res = await apiFetch(`/api/newsletters/${row.id}`, { method: "PATCH", waitForSession: true })
      if (!res.ok) {
        toast.error(await friendlyError(res, `Couldn't ${action} "${row.title}". Try again.`))
        return
      }
      const updated = await res.json()
      setNewsletters(prev =>
        prev.map(n => (n.id === updated.id ? { ...n, published: updated.published } : n))
      )
      toast.success(updated.published ? "Published" : "Moved back to draft")
    } catch {
      toast.error(`Couldn't ${action} "${row.title}". ${CONNECTION_HINT}`)
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(targets: NewsletterRow[]) {
    setIsDeleting(true)
    const deleted = await deleteMany(
      targets,
      n => apiFetch(`/api/newsletters/${n.id}`, { method: "DELETE", waitForSession: true }),
      { one: "newsletter", many: "newsletters" },
    )
    const deletedIds = new Set(deleted.map(n => n.id))
    if (deletedIds.size > 0) setNewsletters(prev => prev.filter(n => !deletedIds.has(n.id)))
    setIsDeleting(false)
    setDeleteTarget(null)
  }

  const clearFnRef = useRef<() => void>(() => {})

  async function handleDuplicate(source: NewsletterRow, newTitle: string, newSlug: string) {
    setIsDuplicating(true)
    try {
      const srcRes = await apiFetch(`/api/newsletters/${source.id}`)
      const src = srcRes.ok ? await srcRes.json() : source

      const res = await apiFetch("/api/newsletters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, slug: newSlug, date: src.date }),
        waitForSession: true,
      })
      if (!res.ok) {
        toast.error(await friendlyError(res, "Couldn't duplicate the newsletter. Try again."))
        return
      }
      const created = await res.json()

      const [bodyRes, entriesRes] = await Promise.all([
        apiFetch(`/api/newsletters/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: src.body ?? "" }),
          waitForSession: true,
        }),
        apiFetch(`/api/newsletters/${created.id}/entries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: src.entries ?? [] }),
          waitForSession: true,
        }),
      ])
      if (!bodyRes.ok || !entriesRes.ok) {
        toast.error("The copy was created, but some content didn't copy over. Check it before sending.")
      }

      setNewsletters(prev => [{ id: created.id, title: newTitle, date: src.date, published: false }, ...prev])
      setDuplicateTarget(null)
      router.push(`/live/manage/newsletters/${created.id}`)
    } catch {
      toast.error(`Couldn't duplicate the newsletter. ${CONNECTION_HINT}`)
    } finally {
      setIsDuplicating(false)
    }
  }

  function handleDownloadTemplate() {
    const blob = new Blob([NEWSLETTER_TEMPLATE], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "newsletter-template.md"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // reset so the same file can be re-selected after an error
    e.target.value = ""
    setIsImporting(true)
    try {
      const text = await file.text()
      const parsed = parseNewsletterTemplate(text)

      // 1. Create newsletter
      const res = await apiFetch("/api/newsletters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: parsed.title,
          date: parsed.date,
          slug: slugify(parsed.title),
        }),
        waitForSession: true,
      })
      if (!res.ok) {
        toast.error(await friendlyError(res, "Couldn't import the template. Try again."))
        return
      }
      const created = await res.json()

      // 2. Set body
      const bodyRes = await apiFetch(`/api/newsletters/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: parsed.body }),
        waitForSession: true,
      })

      // 3. Set entries
      let entriesOk = true
      if (parsed.entries.length > 0) {
        const entries = parsed.entries.map(e => ({
          id: crypto.randomUUID(),
          title: e.title,
          body: e.body,
          date: e.date ?? "",
          authorUsername: "template-import",
          createdAt: new Date().toISOString(),
        }))
        const entriesRes = await apiFetch(`/api/newsletters/${created.id}/entries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
          waitForSession: true,
        })
        entriesOk = entriesRes.ok
      }
      if (!bodyRes.ok || !entriesOk) {
        toast.error("The newsletter was created, but some of the template didn't import. Check it before sending.")
      }

      setNewsletters(prev => [
        { id: created.id, title: parsed.title, date: parsed.date, published: false },
        ...prev,
      ])
      router.push(`/live/manage/newsletters/${created.id}`)
    } catch (err) {
      // parseNewsletterTemplate throws readable messages for malformed files
      toast.error(err instanceof Error && err.name !== "NetworkError" ? err.message : `Couldn't import the template. ${CONNECTION_HINT}`)
    } finally {
      setIsImporting(false)
    }
  }

  function renderRowActions(row: NewsletterRow, className?: string) {
    return (
      <>
        <Button asChild variant="ghost" size="sm" className={className}>
          <Link href={`/live/manage/newsletters/${row.id}`}>Manage</Link>
        </Button>
        <Button variant="ghost" size="sm" className={className} onClick={() => setDuplicateTarget(row)}>
          Duplicate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`w-24 ${className ?? ""}`}
          loading={togglingId === row.id}
          onClick={() => handleTogglePublished(row)}
        >
          {row.published ? "Unpublish" : "Publish"}
        </Button>
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className={`text-destructive hover:text-destructive ${className ?? ""}`}
            onClick={() => setDeleteTarget([row])}
          >
            Delete
          </Button>
        )}
      </>
    )
  }

  const columns: ColumnDef<NewsletterRow>[] = [
    { header: "Title", accessorKey: "title" },
    { header: "Date", accessorKey: "date" },
    { header: "Status", cell: row => <StatusBadge row={row} /> },
    {
      header: "Actions",
      cell: row => (
        <div className="flex items-center gap-1">
          {renderRowActions(row)}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Newsletters</h2>
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={handleDownloadTemplate}>
            Download template
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-10 sm:h-8"
            onClick={() => importInputRef.current?.click()}
            loading={isImporting}
          >
            Import template
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".md,text/markdown,text/plain"
            className="hidden"
            onChange={handleImportFile}
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-10 sm:h-8">New newsletter</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>New newsletter</DialogTitle>
              </DialogHeader>
              <CreateNewsletterForm onCreated={onNewsletterCreated} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DataTable
        columns={columns}
        data={newsletters}
        isLoading={isLoading}
        emptyMessage="No newsletters yet. Start one with New newsletter."
        getRowKey={n => n.id}
        mobileCard={row => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.title}</p>
                <p className="text-sm text-fg-muted">{row.date}</p>
              </div>
              <StatusBadge row={row} />
            </div>
            <div className="-ml-3 flex flex-wrap items-center">
              {renderRowActions(row, "h-10")}
            </div>
          </div>
        )}
        toolbar={(selectedRows, clearSelection) => {
          clearFnRef.current = clearSelection
          if (selectedRows.length === 0 || !isAdmin) return null
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
        title={`Delete ${deleteTarget && deleteTarget.length > 1 ? `${deleteTarget.length} newsletters` : "newsletter"}?`}
        description={
          deleteTarget?.length === 1
            ? <>Delete <span className="font-medium text-foreground">{deleteTarget[0].title}</span>? This can&apos;t be undone.</>
            : "This can't be undone."
        }
        confirmLabel={deleteTarget && deleteTarget.length > 1 ? `Delete ${deleteTarget.length} newsletters` : "Delete newsletter"}
        isLoading={isDeleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
      />

      <Dialog open={duplicateTarget !== null} onOpenChange={open => { if (!open && !isDuplicating) setDuplicateTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Duplicate newsletter</DialogTitle>
          </DialogHeader>
          {duplicateTarget && (
            <DuplicateForm
              defaultTitle={`Copy of ${duplicateTarget.title}`}
              onConfirm={(title, slug) => handleDuplicate(duplicateTarget, title, slug)}
              isLoading={isDuplicating}
            />
          )}
        </DialogContent>
      </Dialog>
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
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; slug?: string; date?: string }>({})

  function handleTitleChange(value: string) {
    setTitle(value)
    setSlug(slugify(value))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof fieldErrors = {}
    if (!title.trim()) errs.title = "Enter a title."
    if (!slug.trim()) errs.slug = "Enter a URL slug."
    if (!date) errs.date = "Pick a date."
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return

    setError("")
    setIsLoading(true)
    try {
      // Create the newsletter first to get an ID
      const res = await apiFetch("/api/newsletters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date, slug }),
        waitForSession: true,
      })
      if (!res.ok) { setError(await friendlyError(res, "Couldn't create the newsletter. Try again.")); return }
      const data = await res.json()
      if (coverFile) {
        // The newsletter already exists at this point, so a cover failure must not block
        // (or duplicate) the create: report it and let the author add the cover in the editor.
        try {
          const image = await prepareImageForUpload(coverFile)
          const presignRes = await apiFetch("/api/upload/newsletter-cover-presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newsletterId: data.id, contentType: image.contentType }),
            waitForSession: true,
          })
          if (!presignRes.ok) throw new ImagePrepError("Couldn't start the cover upload.")
          const { url, key } = await presignRes.json()
          await putToPresignedUrl(url, image)
          const saveRes = await apiFetch(`/api/newsletters/${data.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ coverPhotoKey: key }),
            waitForSession: true,
          })
          if (!saveRes.ok) throw new ImagePrepError("Couldn't save the cover photo.")
        } catch (err) {
          const why = err instanceof ImagePrepError ? `${err.message} ` : ""
          toast.error(`Newsletter created, but the cover wasn't added. ${why}Add it from the editor.`)
        }
      }

      onCreated({ id: data.id, title, date, published: false })
    } catch {
      setError(`Couldn't create the newsletter. ${CONNECTION_HINT}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 pt-2">
      <Field label="Title" error={fieldErrors.title}>
        <Input
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder="e.g. Spring 2026 update"
        />
      </Field>
      <Field label="Slug" hint="Used in the newsletter's web address" error={fieldErrors.slug}>
        <Input
          value={slug}
          onChange={e => setSlug(e.target.value)}
          placeholder="spring-2026-update"
          className="font-mono"
        />
      </Field>
      <Field label="Date" error={fieldErrors.date}>
        <Input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
      </Field>
      <Field label="Cover photo" hint="Optional">
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          onChange={e => setCoverFile(e.target.files?.[0] ?? null)}
          className="text-sm text-fg-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-sm file:text-foreground hover:file:bg-surface-3"
        />
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <FormFooter submitLabel="Create newsletter" isSubmitting={isLoading} />
    </form>
  )
}

function DuplicateForm({
  defaultTitle,
  onConfirm,
  isLoading,
}: {
  defaultTitle: string
  onConfirm: (title: string, slug: string) => void
  isLoading: boolean
}) {
  const [title, setTitle] = useState(defaultTitle)
  const [slug, setSlug] = useState(slugify(defaultTitle))

  function handleTitleChange(v: string) {
    setTitle(v)
    setSlug(slugify(v))
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4 pt-2"
      onSubmit={e => { e.preventDefault(); if (title && slug) onConfirm(title, slug) }}
    >
      <Field label="Title">
        <Input value={title} onChange={e => handleTitleChange(e.target.value)} />
      </Field>
      <Field label="Slug">
        <Input value={slug} onChange={e => setSlug(e.target.value)} className="font-mono" />
      </Field>
      <FormFooter submitLabel="Duplicate newsletter" isSubmitting={isLoading} disabled={!title || !slug} />
    </form>
  )
}
