"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EventCard } from "@/components/gallery/EventCard"
import type { GalleryEvent } from "@/models/GalleryModels"

function getHighestRole(groups: string[]) {
  if (groups.includes("ADMIN")) return "ADMIN"
  if (groups.includes("COACH")) return "COACH"
  return "USER"
}

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  ADMIN: "default",
  COACH: "secondary",
  USER: "outline",
}

interface EventItem {
  id: string
  title: string
  date: string
  location?: string
  description?: string
  coverPhotoKey?: string
  createdAt: string
}

export default function LivePage() {
  const { user, isLoading, signOut } = useAuth()
  const router = useRouter()
  const [events, setEvents] = useState<GalleryEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)

  useEffect(() => {
    if (!isLoading && !user) router.replace("/live/login")
  }, [user, isLoading, router])

  useEffect(() => {
    if (!user) return
    fetch("/api/events")
      .then(res => res.json())
      .then((data: EventItem[]) => {
        const gallery: GalleryEvent[] = data.map(event => ({
          ...event,
          photos: [],
          coverPhotoId: "",
        }))
        setEvents(gallery)
      })
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false))
  }, [user])

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  const role = getHighestRole(user.groups)

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8 text-left">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-black">Void Live</h1>
          <p className="text-white/50 mt-1 text-sm">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={ROLE_VARIANT[role] ?? "outline"}>{role}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/40 hover:text-white hover:bg-white/10"
            onClick={() => router.push("/live/manage")}
          >
            Manage
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/40 hover:text-white hover:bg-white/10"
            onClick={() => signOut().then(() => router.push("/live/login"))}
          >
            Sign out
          </Button>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">Events</h2>
        {eventsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-white/40 text-sm py-16 text-center">No events yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map(event => (
              <EventCard key={event.id} event={event} href={`/live/events/${event.id}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
