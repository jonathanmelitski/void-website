"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Editor } from "@tiptap/react"
import type { NewsletterItem, NewsletterEntry } from "@/lib/aws/newsletters"
import { PROSE_CSS } from "@/lib/newsletter-prose-css"

function NewsletterPreview({ newsletter }: { newsletter: NewsletterItem }) {
  const dateLabel = new Date(newsletter.date).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  })
  const coverUrl = newsletter.coverPhotoKey
    ? `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${newsletter.coverPhotoKey}`
    : null

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: PROSE_CSS }} />

      {coverUrl ? (
        <div className="relative h-64 sm:h-80 rounded-xl overflow-hidden mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverUrl} alt={newsletter.title} className="w-full h-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute bottom-0 inset-x-0 px-8 pb-8">
            <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-1 drop-shadow-lg">{newsletter.title}</h1>
            <p className="text-white/60 text-sm">{dateLabel}</p>
          </div>
        </div>
      ) : (
        <div className="mb-10">
          <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-2">{newsletter.title}</h1>
          <p className="text-white/40 text-sm">{dateLabel}</p>
        </div>
      )}

      {newsletter.body && newsletter.body !== "<p></p>" && (
        <div className="tiptap-prose mb-10" dangerouslySetInnerHTML={{ __html: newsletter.body }} />
      )}

      {(newsletter.entries ?? []).length > 0 && (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl divide-y divide-white/10 overflow-hidden">
          {newsletter.entries.map(entry => (
            <article key={entry.id} className="px-6 sm:px-10 py-8">
              <h2 className="text-xl sm:text-2xl font-bold mb-1">{entry.title}</h2>
              {entry.date && <p className="text-white/35 text-xs mb-6">{entry.date}</p>}
              <div className="tiptap-prose" dangerouslySetInnerHTML={{ __html: entry.body }} />
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ManageNewsletterPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()

  const [newsletter, setNewsletter] = useState<NewsletterItem | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [isToggling, setIsToggling] = useState(false)
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null)
  const [bodySaveStatus, setBodySaveStatus] = useState<"idle" | "pending" | "saving" | "saved">("idle")
  const [tab, setTab] = useState<"edit" | "preview">("edit")
  const [animPhase, setAnimPhase] = useState<"idle" | "out" | "in">("idle")
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [isAddingEntry, setIsAddingEntry] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [entrySaveStatus, setEntrySaveStatus] = useState<Record<string, "idle" | "pending" | "saving" | "saved">>({})
  const bodyEditorRef = useRef<Editor | null>(null)
  const bodyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const entryEditorRefs = useRef<Record<string, Editor | null>>({})
  const entryDebounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const entryPendingBodies = useRef<Record<string, string>>({})

  const isAdmin = user?.groups.includes("ADMIN") ?? false
  const isCoachOrAdmin = user?.groups.includes("COACH") || user?.groups.includes("ADMIN")

  useEffect(() => {
    if (!authLoading && !user) router.replace("/live/login")
  }, [user, authLoading, router])

  useEffect(() => {
    if (!authLoading && user && !isCoachOrAdmin) router.replace("/live/manage")
  }, [user, authLoading, isCoachOrAdmin, router])

  async function loadNewsletter() {
    try {
      const res = await fetch(`/api/newsletters/${id}`)
      if (!res.ok) { setError("Newsletter not found"); return }
      setNewsletter(await res.json())
    } catch {
      setError("Failed to load newsletter")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (id) loadNewsletter()
  }, [id])

  async function handleTogglePublished() {
    if (!newsletter) return
    setIsToggling(true)
    try {
      const res = await fetch(`/api/newsletters/${id}`, { method: "PATCH" })
      if (res.ok) setNewsletter(await res.json())
    } finally {
      setIsToggling(false)
    }
  }

  async function saveBody(html: string) {
    setBodySaveStatus("saving")
    await fetch(`/api/newsletters/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: html }),
    })
    setBodySaveStatus("saved")
  }

  function handleBodyChange(html: string) {
    setBodySaveStatus("pending")
    if (bodyDebounceRef.current) clearTimeout(bodyDebounceRef.current)
    bodyDebounceRef.current = setTimeout(() => saveBody(html), 3000)
  }

  async function saveEntry(entryId: string, fields: { title?: string; date?: string; body?: string }) {
    setEntrySaveStatus(prev => ({ ...prev, [entryId]: "saving" }))
    let updated: NewsletterEntry[] = []
    setNewsletter(prev => {
      if (!prev) return prev
      updated = prev.entries.map(e => e.id === entryId ? { ...e, ...fields } : e)
      return { ...prev, entries: updated }
    })
    // Wait one tick for state to settle, then use latest via ref
    await new Promise(r => setTimeout(r, 0))
    await fetch(`/api/newsletters/${id}/entries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: updated }),
    })
    setEntrySaveStatus(prev => ({ ...prev, [entryId]: "saved" }))
  }

  function handleEntryBodyChange(entryId: string, html: string) {
    entryPendingBodies.current[entryId] = html
    setEntrySaveStatus(prev => ({ ...prev, [entryId]: "pending" }))
    if (entryDebounceRefs.current[entryId]) clearTimeout(entryDebounceRefs.current[entryId])
    entryDebounceRefs.current[entryId] = setTimeout(() => {
      delete entryPendingBodies.current[entryId]
      saveEntry(entryId, { body: html })
    }, 3000)
  }

  async function handleAddEntry() {
    setIsAddingEntry(true)
    try {
      const res = await fetch(`/api/newsletters/${id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New entry", body: "<p></p>" }),
      })
      if (res.ok) {
        const updated = await res.json()
        setNewsletter(updated)
        setEditingEntryId(updated.entries.at(-1)?.id ?? null)
      }
    } finally {
      setIsAddingEntry(false)
    }
  }

  function flushPendingEntrySaves() {
    for (const [entryId, html] of Object.entries(entryPendingBodies.current)) {
      clearTimeout(entryDebounceRefs.current[entryId])
      delete entryPendingBodies.current[entryId]
      saveEntry(entryId, { body: html })
    }
  }

  async function handleDeleteEntry(entryId: string) {
    setDeletingEntryId(entryId)
    try {
      const res = await fetch(`/api/newsletters/${id}/entries/${entryId}`, { method: "DELETE" })
      if (res.ok) {
        setNewsletter(prev =>
          prev ? { ...prev, entries: prev.entries.filter(e => e.id !== entryId) } : prev
        )
      }
    } finally {
      setDeletingEntryId(null)
    }
  }

  async function saveMeta(fields: { title?: string; slug?: string; date?: string; coverPhotoKey?: string }) {
    await fetch(`/api/newsletters/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    })
    setNewsletter(prev => prev ? { ...prev, ...fields } : prev)
  }

  async function handleCoverUpload(file: File) {
    const presignRes = await fetch("/api/upload/newsletter-cover-presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newsletterId: id, contentType: file.type }),
    })
    if (!presignRes.ok) return
    const { url, key } = await presignRes.json()
    await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
    await saveMeta({ coverPhotoKey: key })
  }

  async function moveEntry(index: number, direction: -1 | 1) {
    if (!newsletter) return
    const entries = [...newsletter.entries]
    const target = index + direction
    if (target < 0 || target >= entries.length) return
    ;[entries[index], entries[target]] = [entries[target], entries[index]]
    setNewsletter(prev => prev ? { ...prev, entries } : prev)
    await fetch(`/api/newsletters/${id}/entries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    })
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !newsletter) {
    return (
      <div className="p-8 lg:px-16">
        <p className="text-red-400">{error || "Newsletter not found"}</p>
      </div>
    )
  }

  const dateLabel = new Date(newsletter.date).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  })

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-6">

      {/* Page header */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => router.push("/live/manage?tab=newsletters")}
          className="text-white/40 hover:text-white/70 text-sm self-start flex items-center gap-1 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-black">{newsletter.title}</h1>
        <p className="text-white/50 text-sm -mt-2">{dateLabel}</p>

        {/* Publish toggle */}
        <button
          onClick={handleTogglePublished}
          disabled={isToggling}
          className="relative flex items-center bg-white/[0.06] border border-white/10 rounded-full p-1 gap-1 disabled:opacity-50"
          aria-label="Toggle published state"
        >
          <span
            className={`px-4 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
              !newsletter.published
                ? "bg-white/15 text-white"
                : "text-white/40"
            }`}
          >
            Draft
          </span>
          <span
            className={`px-4 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
              newsletter.published
                ? "bg-white text-black"
                : "text-white/40"
            }`}
          >
            {isToggling ? "…" : "Published"}
          </span>
        </button>

        {/* Export */}
        <a
          href={`/api/newsletters/${id}/export`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          Export HTML ↗
        </a>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`text-xs transition-colors ${showSettings ? "text-white/60" : "text-white/30 hover:text-white/60"}`}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 flex flex-col gap-4">
          <h2 className="text-sm font-semibold">Newsletter settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-white/50">Title</Label>
              <Input
                defaultValue={newsletter.title}
                onBlur={e => e.target.value && saveMeta({ title: e.target.value })}
                className="bg-white/5 border-white/10 text-white h-8 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-white/50">Slug</Label>
              <Input
                defaultValue={newsletter.slug}
                onBlur={e => e.target.value && saveMeta({ slug: e.target.value })}
                className="bg-white/5 border-white/10 text-white h-8 text-sm font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-white/50">Date</Label>
              <Input
                type="date"
                defaultValue={newsletter.date}
                onBlur={e => e.target.value && saveMeta({ date: e.target.value })}
                className="bg-white/5 border-white/10 text-white h-8 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-white/50">Cover photo</Label>
              {newsletter.coverPhotoKey && (
                <p className="text-xs text-white/30 font-mono truncate">{newsletter.coverPhotoKey}</p>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleCoverUpload(f) }}
                className="text-xs text-white/50 file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white hover:file:bg-white/20"
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab selector */}
      <div className="flex justify-center border-b border-white/10">
        {(["edit", "preview"] as const).map(t => (
          <button
            key={t}
            onClick={() => {
              if (t === tab || animPhase !== "idle") return
              if (t === "preview") {
                const html = bodyEditorRef.current?.getHTML() ?? ""
                setNewsletter(prev => prev ? { ...prev, body: html } : prev)
                if (bodySaveStatus === "pending") {
                  if (bodyDebounceRef.current) clearTimeout(bodyDebounceRef.current)
                  saveBody(html)
                }
                flushPendingEntrySaves()
              }
              setAnimPhase("out")
              setTimeout(() => {
                setTab(t)
                setAnimPhase("in")
                setTimeout(() => setAnimPhase("idle"), 150)
              }, 100)
            }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              tab === t
                ? "border-white text-white"
                : "border-transparent text-white/40 hover:text-white/60"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <style>{`
        @keyframes pageOut {
          0%   { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(-12px); }
        }
        @keyframes pageIn {
          0%   { opacity: 0; transform: translateX(12px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        .page-turn-out { animation: pageOut 100ms ease-in forwards; }
        .page-turn-in  { animation: pageIn  150ms ease-out forwards; }
      `}</style>

      {/* ── TAB CONTENT ── */}
      <div
        className={
          animPhase === "out" ? "page-turn-out" :
          animPhase === "in"  ? "page-turn-in"  : ""
        }
      >

      {/* ── EDIT TAB ── */}
      {tab === "edit" && (
        <div className="flex flex-col gap-8">

          {/* Global body */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center">
              <div className="w-16 shrink-0" />
              <div className="flex-1 text-center">
                <h2 className="text-base font-semibold">Newsletter body</h2>
                <p className="text-white/40 text-xs mt-0.5">Displayed before entries on the public page.</p>
              </div>
              <span className="text-xs text-white/30 w-16 text-right shrink-0">
                {bodySaveStatus === "pending" && "Unsaved…"}
                {bodySaveStatus === "saving" && "Saving…"}
                {bodySaveStatus === "saved" && "Saved"}
              </span>
            </div>
            <SimpleEditor
              initialContent={newsletter.body ?? ""}
              onEditorReady={editor => { bodyEditorRef.current = editor }}
              onChange={handleBodyChange}
            />
          </div>

          {/* Entries list */}
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">
              Entries <span className="text-white/30 font-normal">({newsletter.entries?.length ?? 0})</span>
            </h2>

            {(newsletter.entries ?? []).length === 0 ? (
              <p className="text-white/40 text-sm">No entries yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {newsletter.entries.map((entry, i) => {
                  const canDelete = isAdmin || entry.authorUsername === user?.username
                  const isFirst = i === 0
                  const isLast = i === newsletter.entries.length - 1
                  const isExpanded = editingEntryId === entry.id
                  return (
                    <div key={entry.id} className="bg-white/[0.03] border border-white/10 rounded-lg overflow-hidden">
                      {/* Header row */}
                      <div className="relative flex items-center gap-3 px-4 py-3">
                        {/* Centered title */}
                        <div className="absolute inset-x-0 text-center pointer-events-none">
                          <p className="font-medium text-sm">{entry.title}</p>
                          {entry.date && <p className="text-white/40 text-xs mt-0.5">{entry.date}</p>}
                        </div>
                        {/* Reorder */}
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            onClick={() => moveEntry(i, -1)}
                            disabled={isFirst}
                            className="text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed leading-none transition-colors"
                            aria-label="Move up"
                          >▲</button>
                          <button
                            onClick={() => moveEntry(i, 1)}
                            disabled={isLast}
                            className="text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed leading-none transition-colors"
                            aria-label="Move down"
                          >▼</button>
                        </div>

                        {/* spacer */}
                        <div className="flex-1" />

                        {/* Edit toggle */}
                        <button
                          onClick={() => setEditingEntryId(isExpanded ? null : entry.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors shrink-0 ${
                            isExpanded
                              ? "bg-white/15 text-white"
                              : "bg-white/[0.06] text-white/50 hover:bg-white/10 hover:text-white/80"
                          }`}
                          aria-label="Edit entry"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                          {isExpanded ? "Finish Editing" : "Edit"}
                        </button>

                        {/* Delete */}
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteEntry(entry.id)}
                            disabled={deletingEntryId === entry.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-red-500/10 text-red-400/70 hover:bg-red-500/20 hover:text-red-400 transition-colors shrink-0 disabled:opacity-40"
                          >
                            {deletingEntryId === entry.id ? (
                              "…"
                            ) : (
                              <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6"/>
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                  <path d="M10 11v6"/>
                                  <path d="M14 11v6"/>
                                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                </svg>
                                Delete
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Expanded editor */}
                      {isExpanded && (
                        <div className="border-t border-white/10 px-4 py-4 flex flex-col gap-3">
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-white/50">Title</label>
                            <input
                              defaultValue={entry.title}
                              onBlur={e => saveEntry(entry.id, { title: e.target.value })}
                              className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/30"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-white/50">Date <span className="text-white/25">(optional)</span></label>
                            <input
                              defaultValue={entry.date ?? ""}
                              onBlur={e => saveEntry(entry.id, { date: e.target.value || undefined })}
                              placeholder="March 2026"
                              className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/30"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-white/50">Body</label>
                              <span className="text-xs text-white/30">
                                {entrySaveStatus[entry.id] === "pending" && "Unsaved…"}
                                {entrySaveStatus[entry.id] === "saving" && "Saving…"}
                                {entrySaveStatus[entry.id] === "saved" && "Saved"}
                              </span>
                            </div>
                            <SimpleEditor
                              initialContent={entry.body}
                              onEditorReady={editor => { entryEditorRefs.current[entry.id] = editor }}
                              onChange={html => handleEntryBodyChange(entry.id, html)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Add entry */}
          <button
            onClick={handleAddEntry}
            disabled={isAddingEntry}
            className="self-center text-sm text-white/40 hover:text-white/70 border border-dashed border-white/15 hover:border-white/30 rounded-lg px-4 py-2.5 transition-colors disabled:opacity-40"
          >
            {isAddingEntry ? "Adding…" : "+ New entry"}
          </button>
        </div>
      )}

      {/* ── PREVIEW TAB ── */}
      {tab === "preview" && (
        <NewsletterPreview newsletter={newsletter} />
      )}

      </div>{/* end animated tab content */}
    </div>
  )
}

