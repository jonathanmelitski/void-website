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
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer, PageHeader } from "@/components/ui/page"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, ImageIcon } from "lucide-react"
import { formatDate } from "@/lib/format-date"
import { UserPanel } from "@/app/live/manage/UserPanel"

interface EventGalleryViewProps {
  event: GalleryEvent
}

export function EventGalleryView({ event }: EventGalleryViewProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [photos, setPhotos] = useState<Photo[]>(event.photos)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [loaded, setLoaded] = useState(event.photos.length > 0)
  const { user } = useAuth()
  const canUpload = !!user?.groups?.some(g => g === "ADMIN" || g === "COACH")

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
      .finally(() => setLoaded(true))
  }, [event.id, event.photos, event.title])

  const dateLabel = formatDate(event.date)
  const meta = [dateLabel, event.location].filter(Boolean).join(" · ")

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href="/" className="inline-flex h-10 items-center gap-1.5 rounded-md font-medium hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Home
          </Link>
        }
        title={event.title}
        description={
          <>
            {meta && <span className="block">{meta}</span>}
            {event.description && <span className="mt-2 block text-fg-secondary">{event.description}</span>}
          </>
        }
        actions={canUpload && (
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">Upload photos</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload photos</DialogTitle>
              </DialogHeader>
              <UserPanel />
            </DialogContent>
          </Dialog>
        )}
      />

      {!loaded ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading photos">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <EmptyState
          variant="page"
          icon={<ImageIcon />}
          title="No photos from this event yet"
          description={canUpload ? "Upload photos to share them here." : "Check back after the team posts them."}
          action={
            canUpload ? (
              <Button size="sm" onClick={() => setUploadOpen(true)}>Upload photos</Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link href="/news">Read the news</Link>
              </Button>
            )
          }
        />
      ) : (
        <PhotoGrid photos={photos} onPhotoClick={i => setLightboxIndex(i)} />
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          title={event.title}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </PageContainer>
  )
}
