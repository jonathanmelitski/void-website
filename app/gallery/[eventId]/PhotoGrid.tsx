'use client'

import Image from "next/image"
import type { Photo } from "@/models/GalleryModels"

interface PhotoGridProps {
  photos: Photo[]
  onPhotoClick: (index: number) => void
}

export function PhotoGrid({ photos, onPhotoClick }: PhotoGridProps) {
  return (
    <div className="columns-1 md:columns-2 lg:columns-3 gap-4">
      {photos.map((photo, i) => (
        <button
          key={photo.id}
          onClick={() => onPhotoClick(i)}
          className="break-inside-avoid mb-4 w-full block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg overflow-hidden"
        >
          <div className="relative max-h-96 overflow-hidden w-full rounded-lg">
            <Image
              src={photo.url}
              alt={photo.alt}
              width={photo.width ?? 1200}
              height={photo.height ?? 800}
              className="w-full h-auto object-cover hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        </button>
      ))}
    </div>
  )
}
