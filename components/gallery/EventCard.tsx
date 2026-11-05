'use client'

import Image from "next/image"
import { Lock } from "lucide-react"
import { PrefetchLink } from "@/components/prefetch-link"
import type { GalleryEvent } from "@/models/GalleryModels"
import { formatEventDate } from "@/lib/format-date"

interface EventCardProps {
  event: GalleryEvent
  href?: string
  /** Shows a "Private" pill (Void Live event list). */
  isPrivate?: boolean
}

export function EventCard({ event, href, isPrivate }: EventCardProps) {
  const cover = event.photos.find(p => p.id === event.coverPhotoId) ?? event.photos[0]
  const coverUrl = cover?.url ?? (event.coverPhotoKey
    ? `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${event.coverPhotoKey}`
    : null)

  const dateLabel = formatEventDate(event.date)

  if (!coverUrl) {
    return (
      <PrefetchLink href={href ?? `/gallery/${event.id}`} apiPrefetchUrls={[`/api/events/${event.id}`]} className="block group">
        <div className="bg-surface border border-border rounded-xl overflow-hidden transition-colors group-hover:bg-surface-2">
          <div className="relative aspect-[4/3] flex items-center justify-center text-fg-muted text-sm">
            No cover photo
            {isPrivate && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-1 text-xs font-medium text-fg-secondary">
                <Lock className="size-3" aria-hidden />
                Private
              </span>
            )}
            <div className="absolute bottom-0 left-0 right-0 p-4 text-foreground">
              <h3 className="font-semibold text-lg leading-tight">{event.title}</h3>
              <p className="text-sm text-fg-secondary mt-0.5">{dateLabel}</p>
              {event.location && <p className="text-xs text-fg-muted mt-0.5">{event.location}</p>}
            </div>
          </div>
        </div>
      </PrefetchLink>
    )
  }

  return (
    <PrefetchLink href={href ?? `/gallery/${event.id}`} apiPrefetchUrls={[`/api/events/${event.id}`]} className="block group">
      <div className="bg-white/10 backdrop-blur-sm rounded-xl overflow-hidden">
        <div className="relative aspect-[4/3] hover:scale-[1.02] transition-transform">
          <Image
            src={coverUrl}
            alt={cover?.alt ?? event.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          {/* Private / photo count pills */}
          {(isPrivate || event.photos.length > 0) && (
            <div className="absolute top-3 right-3 flex gap-1.5">
              {isPrivate && (
                <span className="inline-flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-full px-2 py-1 text-white text-xs font-medium">
                  <Lock className="size-3" aria-hidden />
                  Private
                </span>
              )}
              {event.photos.length > 0 && (
                <span className="bg-white/20 backdrop-blur-sm rounded-full px-2 py-1 text-white text-xs font-medium">
                  {event.photos.length} {event.photos.length === 1 ? "photo" : "photos"}
                </span>
              )}
            </div>
          )}
          {/* Title / date / location */}
          <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
            <h3 className="font-semibold text-lg leading-tight">{event.title}</h3>
            <p className="text-sm text-white/90 mt-0.5">{dateLabel}</p>
            {event.location && (
              <p className="text-xs text-white/80 mt-0.5">{event.location}</p>
            )}
          </div>
        </div>
      </div>
    </PrefetchLink>
  )
}
