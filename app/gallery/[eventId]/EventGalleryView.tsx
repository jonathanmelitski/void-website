'use client'

import { useEffect, useState } from "react"
import Link from "next/link"
import type { GalleryEvent, Photo } from "@/models/GalleryModels"
import { PhotoGrid } from "./PhotoGrid"
import { Lightbox } from "./Lightbox"
import { useAuth } from "@/lib/use-auth"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { UserPanel } from "@/app/live/manage/UserPanel"

interface EventGalleryViewProps {
  event: GalleryEvent
}

export function EventGalleryView({ event }: EventGalleryViewProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [photos, setPhotos] = useState<Photo[]>(event.photos)
  const [uploadOpen, setUploadOpen] = useState(false)
  const { user } = useAuth()

  useEffect(() => {
    if (event.photos.length > 0) return
    fetch(`/api/events/${event.id}/photos`)
      .then(r => r.json())
      .then((urls: string[]) => {
        if (!Array.isArray(urls)) return
        setPhotos(urls.map((url, i) => ({
          id: `photo-${i}`,
          url,
          alt: `${event.title} photo ${i + 1}`,
        })))
      })
      .catch(() => {})
  }, [event.id, event.photos, event.title])

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

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-black">{event.title}</h1>
          <p className="text-muted-foreground mt-1">
            {dateLabel}{event.location ? ` · ${event.location}` : ""}
          </p>
          {event.description && (
            <p className="mt-2 text-sm">{event.description}</p>
          )}
        </div>
        {user && (
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">Upload Photo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Photo</DialogTitle>
              </DialogHeader>
              <UserPanel />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <PhotoGrid photos={photos} onPhotoClick={i => setLightboxIndex(i)} />

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  )
}
