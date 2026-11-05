"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { useAuth } from "@/lib/use-auth"
import { useRequireAuth } from "@/hooks/use-require-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EventCard } from "@/components/gallery/EventCard"
import type { GalleryEvent } from "@/models/GalleryModels"
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer, PageHeader } from "@/components/ui/page"

function getHighestRole(groups: string[]) {
  if (groups.includes("ADMIN")) return "ADMIN"
  if (groups.includes("COACH")) return "COACH"
  return "USER"
}

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", COACH: "Coach", USER: "Player" }

const ROLE_VARIANT: Record<string, "brand" | "secondary" | "outline"> = {
  ADMIN: "brand",
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
  isPrivate?: boolean
  createdAt: string
}

type LiveEvent = GalleryEvent & { isPrivate?: boolean }

export default function LivePage() {
  const { signOut, status } = useAuth()
  const { user, isLoading } = useRequireAuth()
  const router = useRouter()
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  // Whether the last events fetch went out with a confirmed session (private events need one).
  const [fetchedAuthed, setFetchedAuthed] = useState<boolean | null>(null)

  const loadEvents = useCallback((authed: boolean) => {
    setEventsError(false)
    setFetchedAuthed(authed)
    fetch("/api/events")
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then((data: EventItem[]) => {
        setEvents(data.map(event => ({ ...event, photos: [], coverPhotoId: "" })))
      })
      .catch(() => setEventsError(true))
      .finally(() => setEventsLoading(false))
  }, [])

  // Start loading events alongside the auth check (the API filters private events by session);
  // fetch once more after sign-in is confirmed if the first request went out before that.
  useEffect(() => {
    const authed = status === "authenticated"
    if (fetchedAuthed === null || (authed && !fetchedAuthed)) loadEvents(authed)
  }, [status, fetchedAuthed, loadEvents])

  if (isLoading || !user) return <LiveHomeSkeleton />

  const role = getHighestRole(user.groups)
  const canManage = role === "ADMIN" || role === "COACH"

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      router.push("/live/login")
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Void Live"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {user.email && <span className="min-w-0 break-all">{user.email}</span>}
            <Badge variant={ROLE_VARIANT[role] ?? "outline"}>{ROLE_LABEL[role] ?? role}</Badge>
          </span>
        }
        actions={
          <>
            {canManage && (
              <Button asChild variant="outline" size="lg">
                <Link href="/live/manage">Manage</Link>
              </Button>
            )}
            <Button variant="ghost" size="lg" loading={signingOut} onClick={handleSignOut}>
              Sign out
            </Button>
          </>
        }
      />

      <section aria-labelledby="events-heading">
        <h2 id="events-heading" className="text-lg font-semibold mb-4">Events</h2>
        {eventsLoading ? (
          <EventGridSkeleton />
        ) : eventsError ? (
          <EmptyState
            icon={<CalendarDays />}
            title="Couldn't load events"
            description="Check your connection and try again."
            action={<Button size="sm" variant="outline" onClick={() => { setEventsLoading(true); loadEvents(status === "authenticated") }}>Try again</Button>}
          />
        ) : events.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title="No events yet"
            description={canManage ? "Create an event in Manage to start scoring games." : "Events will show up here once a coach adds them."}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map(event => (
              <EventCard key={event.id} event={event} isPrivate={event.isPrivate} href={`/live/events/${event.id}`} />
            ))}
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function EventGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy aria-label="Loading events">
      {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
    </div>
  )
}

function LiveHomeSkeleton() {
  return (
    <PageContainer>
      <div className="mb-6 flex flex-col gap-3 md:mb-8">
        <Skeleton className="h-10 w-48 md:h-12" />
        <Skeleton className="h-5 w-64 max-w-full" />
      </div>
      <Skeleton className="h-6 w-24 mb-4" />
      <EventGridSkeleton />
    </PageContainer>
  )
}
