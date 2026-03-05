export type Photo = {
  id: string
  url: string
  alt: string
  width?: number
  height?: number
}

export type GalleryEvent = {
  id: string
  title: string
  date: string
  location?: string
  description?: string
  coverPhotoId: string
  coverPhotoKey?: string
  photos: Photo[]
}
