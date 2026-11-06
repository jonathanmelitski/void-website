import Image from "next/image"
import { EventCard } from "@/components/gallery/EventCard"
import { PageContainer } from "@/components/ui/page"
import teamPhoto from "@/public/void-team.png"
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
    <PageContainer className="flex flex-col gap-16 md:gap-24">
      <section aria-labelledby="home-title" className="grid items-center gap-10 pt-4 md:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
        <div className="flex flex-col gap-6">
          {/* Stacked on purpose: one line of Bebas at this size overflows phones and the half-width hero column. */}
          <h1 id="home-title" className="font-display text-8xl leading-[0.82] tracking-wide text-foreground xl:text-9xl">
            <span className="block">Void</span>
            <span className="block">Ultimate</span>
          </h1>
          <div className="flex max-w-[65ch] flex-col gap-4 text-lg leading-relaxed text-fg-secondary">
            <p>
              Men&apos;s Club Ultimate Frisbee (Void) is a student group open to all students at the University of Pennsylvania. Void was founded in 1976 and is the longest continuously-run Ultimate program in Philadelphia. We compete as a D1 Men&apos;s College Ultimate program. Our program has won one national championship (1985) and has alumni playing at the highest levels of club and professionally in the UFA.
            </p>
            <p>
              We offer an A team and a B team, called Null. While Void is competitive in nature, we do not cut from the program. Anyone who wants to play on Null can. Our goals as a club are to introduce the sport and grow love for Ultimate on Null, and to compete at the highest levels on Void.
            </p>
          </div>
        </div>
        <figure className="overflow-hidden rounded-xl border border-border bg-surface">
          <Image
            src={teamPhoto}
            alt="The Void Ultimate team posing together on the field"
            priority
            placeholder="blur"
            sizes="(min-width: 1024px) 560px, 100vw"
            className="h-auto w-full object-cover"
          />
        </figure>
      </section>

      {recentEvents.length > 0 && (
        <section aria-labelledby="events-title" className="flex flex-col gap-6">
          <h2 id="events-title" className="font-display text-4xl leading-none tracking-wide text-foreground">
            Recent Events
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
    </PageContainer>
  )
}
