'use client'

import Link from "next/link"
import Image from "next/image"
import type { GalleryEvent } from "@/models/GalleryModels"

interface EventCardProps {
  event: GalleryEvent
}

export function EventCard({ event }: EventCardProps) {
  const cover = event.photos.find(p => p.id === event.coverPhotoId) ?? event.photos[0]
  const dateLabel = new Date(event.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return (
    <Link href={`/gallery/${event.id}`} className="block group">
      <div className="bg-white/10 backdrop-blur-sm rounded-lg overflow-hidden">
        <div className="relative aspect-[4/3] hover:scale-[1.02] transition-transform">
          <Image
            src={cover.url}
            alt={cover.alt}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          {/* Photo count badge */}
          <div className="absolute top-3 right-3 bg-white/20 backdrop-blur-sm rounded-full px-2 py-1 text-white text-xs font-medium">
            {event.photos.length} photos
          </div>
          {/* Title / date / location */}
          <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
            <h3 className="font-bold text-lg leading-tight">{event.title}</h3>
            <p className="text-sm text-white/80 mt-0.5">{dateLabel}</p>
            {event.location && (
              <p className="text-xs text-white/60 mt-0.5">{event.location}</p>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
