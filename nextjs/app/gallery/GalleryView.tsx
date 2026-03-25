'use client'

import type { GalleryEvent } from "@/models/GalleryModels"
import { EventCard } from "@/components/gallery/EventCard"

interface GalleryViewProps {
  events: GalleryEvent[]
}

export function GalleryView({ events }: GalleryViewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {events.map(event => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  )
}
