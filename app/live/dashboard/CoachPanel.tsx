"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function CoachPanel() {
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [location, setLocation] = useState("")
  const [description, setDescription] = useState("")
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [createdId, setCreatedId] = useState("")

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
      setCreatedId(data.id)
      setTitle(""); setDate(""); setLocation(""); setDescription(""); setCoverFile(null)
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  if (createdId) {
    return (
      <div className="flex flex-col gap-4 max-w-md text-left">
        <p className="text-green-400 text-sm">Event created.</p>
        <div className="flex gap-3">
          <Link href={`/gallery/${createdId}`}>
            <Button variant="outline" size="sm">View in gallery</Button>
          </Link>
          <Button variant="ghost" size="sm" className="text-white/50 hover:text-white" onClick={() => setCreatedId("")}>
            Create another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 max-w-md text-left">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
    </div>
  )
}
