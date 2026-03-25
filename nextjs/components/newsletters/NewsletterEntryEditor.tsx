"use client"

import { useRef, useState } from "react"
import type { Editor } from "@tiptap/react"
import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface Props {
  newsletterId: string
  onEntryAdded: () => void
}

export function NewsletterEntryEditor({ newsletterId, onEntryAdded }: Props) {
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const editorRef = useRef<Editor | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    const body = editorRef.current?.getHTML() ?? ""
    if (!title.trim() || !body || body === "<p></p>") {
      setError("Title and body are required")
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, date: date || null }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? "Failed to add entry")
        return
      }
      editorRef.current?.commands.clearContent()
      setTitle("")
      setDate("")
      onEntryAdded()
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold">Add Entry</h3>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Entry title</Label>
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What I've been working on…"
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Date <span className="text-white/30">(optional, e.g. "March 2026")</span></Label>
        <Input
          value={date}
          onChange={e => setDate(e.target.value)}
          placeholder="March 2026"
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-white/70">Body</Label>
        <SimpleEditor onEditorReady={editor => { editorRef.current = editor }} />
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-fit">
        {isSubmitting ? "Adding…" : "Add entry"}
      </Button>
    </form>
  )
}
