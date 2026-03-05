import { notFound } from "next/navigation"
import type { EventItem } from "@/lib/aws/dynamo"
import { EventGalleryView } from "./EventGalleryView"

interface Props {
  params: Promise<{ eventId: string }>
}

async function getEvent(id: string): Promise<EventItem | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/events/${id}`, { cache: "no-store" })
    if (res.status === 404) return null
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function EventPage({ params }: Props) {
  const { eventId } = await params
  const event = await getEvent(eventId)
  if (!event) notFound()

  return (
    <EventGalleryView
      event={{
        id: event.id,
        title: event.title,
        date: event.date,
        location: event.location,
        description: event.description,
        coverPhotoId: "",
        coverPhotoKey: event.coverPhotoKey,
        photos: [],
      }}
    />
  )
}
