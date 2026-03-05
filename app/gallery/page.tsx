import type { Metadata } from "next"
import { SampleEvents } from "@/models/GallerySampleData"
import { GalleryView } from "./GalleryView"

export const metadata: Metadata = {
  title: "Gallery | Void Ultimate",
}

export default function GalleryPage() {
  const events = [...SampleEvents].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  return (
    <div className="p-8 lg:px-16">
      <h1 className="text-4xl font-black mb-8">Gallery</h1>
      <GalleryView events={events} />
    </div>
  )
}
