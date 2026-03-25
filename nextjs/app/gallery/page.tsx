import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { EventItem } from "@/lib/aws/dynamo"
import { GalleryView } from "./GalleryView"

export const metadata: Metadata = {
  title: "Gallery | Void Ultimate",
}

async function getEvents(): Promise<EventItem[]> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/events`, { cache: "no-store" })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export default async function GalleryPage() {
  notFound()
  const events = await getEvents()

  const galleryEvents = events.map(event => ({
    id: event.id,
    title: event.title,
    date: event.date,
    location: event.location,
    description: event.description,
    coverPhotoId: "",
    coverPhotoKey: event.coverPhotoKey,
    photos: [],
  }))

  return (
    <div className="p-8 lg:px-16">
      <h1 className="text-4xl font-black mb-8">Gallery</h1>
      <GalleryView events={galleryEvents} />
    </div>
  )
}
