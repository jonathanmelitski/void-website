import Link from "next/link"
import { EventCard } from "@/components/gallery/EventCard"
import type { EventItem } from "@/lib/aws/dynamo"

async function getRecentEvents(): Promise<EventItem[]> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/events`, { cache: "no-store" })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export default async function App() {
  const recentEvents = await getRecentEvents()

  return (
    <div className="flex flex-col items-center align-middle h-full gap-8 pt-8 lg:px-16 not-lg:p-8">
      <header className="text-6xl font-black p-12">
        Void Ultimate
      </header>
      <b className="text-lg">
        Men&apos;s Club Ultimate Frisbee (Void) is a student group open to all students at the University of Pennsylvania. Void was founded in 1976 and is the longest continuously-run Ultimate program in Philadelphia. We compete as a D1 Men&apos;s College Ultimate program. Our program has won one national championship (1985) and has alumni playing at the highest levels of club and professionally in the UFA.
      </b>

      <b className="text-lg">
        We offer an A team and a B team, called Null. While Void is competitive in nature, we do not cut from the program. Anyone who wants to play on Null can. Our goals as a club are to introduce the sport and grow love for Ultimate on Null, and to compete at the highest levels on Void.
      </b>

      {recentEvents.length > 0 && (
        <section className="w-full mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Recent Events</h2>
            <Link href="/gallery" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentEvents.map(event => (
              <EventCard key={event.id} event={{
                id: event.id,
                title: event.title,
                date: event.date,
                location: event.location,
                description: event.description,
                coverPhotoId: "",
                coverPhotoKey: event.coverPhotoKey,
                photos: [],
              }} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
