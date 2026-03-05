'use client'

import { useState } from "react"
import Link from "next/link"
import type { GalleryEvent } from "@/models/GalleryModels"
import { PhotoGrid } from "./PhotoGrid"
import { Lightbox } from "./Lightbox"

interface EventGalleryViewProps {
  event: GalleryEvent
}

export function EventGalleryView({ event }: EventGalleryViewProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const dateLabel = new Date(event.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return (
    <div className="p-8 lg:px-16">
      <Link
        href="/gallery"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        ← Back to Gallery
      </Link>

      <div className="mb-8">
        <h1 className="text-4xl font-black">{event.title}</h1>
        <p className="text-muted-foreground mt-1">{dateLabel}{event.location ? ` · ${event.location}` : ""}</p>
        {event.description && (
          <p className="mt-2 text-sm">{event.description}</p>
        )}
      </div>

      <PhotoGrid photos={event.photos} onPhotoClick={i => setLightboxIndex(i)} />

      {lightboxIndex !== null && (
        <Lightbox
          photos={event.photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  )
}
