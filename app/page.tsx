import { EventCard } from "@/components/gallery/EventCard"
import { listEvents, type EventItem } from "@/lib/aws/dynamo"
import { canViewEvent } from "@/lib/event-access"

// Public page: regenerated at most once a minute (ISR) instead of a DynamoDB Scan per view.
// Event create/delete also revalidate "/" on demand.
export const revalidate = 60

// Reads DynamoDB directly (no HTTP hop through our own /api). Anonymous view: public events only.
async function getRecentEvents(): Promise<EventItem[]> {
  try {
    return (await listEvents()).filter(e => canViewEvent(e, null))
  } catch (err) {
    // At build time (no AWS access) render without events; ISR fills them in. At runtime rethrow,
    // so a failed regeneration keeps serving the last good page instead of caching an empty one.
    if (process.env.NEXT_PHASE === "phase-production-build") return []
    throw err
  }
}

export default async function App() {
  const recentEvents = await getRecentEvents()

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <h1 className="font-display text-6xl leading-none tracking-wide text-center pt-12 pb-4 md:text-8xl">
        Void Ultimate
      </h1>
      <b className="text-lg text-center">
        Men&apos;s Club Ultimate Frisbee (Void) is a student group open to all students at the University of Pennsylvania. Void was founded in 1976 and is the longest continuously-run Ultimate program in Philadelphia. We compete as a D1 Men&apos;s College Ultimate program. Our program has won one national championship (1985) and has alumni playing at the highest levels of club and professionally in the UFA.
      </b>

      <b className="text-lg text-center">
        We offer an A team and a B team, called Null. While Void is competitive in nature, we do not cut from the program. Anyone who wants to play on Null can. Our goals as a club are to introduce the sport and grow love for Ultimate on Null, and to compete at the highest levels on Void.
      </b>

      {recentEvents.length > 0 && (
        <section className="w-full mt-4">
          <h2 className="mb-4 text-lg font-semibold">Recent events</h2>
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
