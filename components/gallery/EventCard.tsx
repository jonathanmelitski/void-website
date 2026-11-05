'use client'

import Image from "next/image"
import { PrefetchLink } from "@/components/prefetch-link"
import type { GalleryEvent } from "@/models/GalleryModels"
import { Logo } from "@/components/navbar-01"
import { formatDate } from "@/lib/format-date"

interface EventCardProps {
  event: GalleryEvent
  href?: string
}

export function EventCard({ event, href }: EventCardProps) {
  const cover = event.photos.find(p => p.id === event.coverPhotoId) ?? event.photos[0]
  const coverUrl = cover?.url ?? (event.coverPhotoKey
    ? `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${event.coverPhotoKey}`
    : null)

  const dateLabel = formatDate(event.date)

  if (!coverUrl) {
    // No cover yet: a designed tile (brand wash + Void glyph) instead of an empty grey box.
    return (
      <PrefetchLink href={href ?? `/gallery/${event.id}`} apiPrefetchUrls={[`/api/events/${event.id}`]} className="block group rounded-xl">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-surface transition-colors group-hover:border-border-strong">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklch,var(--brand)_28%,transparent),transparent_65%)]"
          />
          <Logo
            aria-hidden="true"
            className="absolute -right-6 -top-4 size-44 text-brand-text opacity-15 transition-transform duration-500 group-hover:-rotate-6 motion-reduce:transition-none"
          />
          <div className="absolute inset-x-0 bottom-0 p-4 text-foreground">
            <h3 className="text-lg font-semibold leading-tight">{event.title}</h3>
            {dateLabel && <p className="mt-0.5 text-sm text-fg-secondary">{dateLabel}</p>}
            {event.location && <p className="mt-0.5 text-xs text-fg-muted">{event.location}</p>}
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
          {/* Photo count badge (only when we actually know the count) */}
          {event.photos.length > 0 && (
            <div className="absolute top-3 right-3 bg-white/20 backdrop-blur-sm rounded-full px-2 py-1 text-white text-xs font-medium">
              {event.photos.length} {event.photos.length === 1 ? "photo" : "photos"}
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
