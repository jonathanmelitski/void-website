import { notFound } from "next/navigation"
import { SampleEvents } from "@/models/GallerySampleData"
import { EventGalleryView } from "./EventGalleryView"

export function generateStaticParams() {
  return SampleEvents.map(event => ({ eventId: event.id }))
}

interface Props {
  params: Promise<{ eventId: string }>
}

export default async function EventPage({ params }: Props) {
  const { eventId } = await params
  const event = SampleEvents.find(e => e.id === eventId)
  if (!event) notFound()

  return <EventGalleryView event={event} />
}
