import Image from "next/image"
import Link from "next/link"
import { EventCard } from "@/components/gallery/EventCard"
import { Button } from "@/components/ui/button"
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
          <p className="max-w-[34rem] text-lg leading-relaxed text-fg-secondary md:text-xl">
            Penn&apos;s men&apos;s ultimate frisbee team. Founded in 1976, Void is the longest continuously run ultimate program in Philadelphia.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/roster">Meet the roster</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="bg-background/60">
              <Link href="/donate">Support the team</Link>
            </Button>
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

      <section aria-labelledby="program-title" className="grid gap-6 border-t border-border pt-10 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-12">
        <h2 id="program-title" className="font-display text-4xl leading-none tracking-wide text-foreground">
          The program
        </h2>
        <div className="flex max-w-[65ch] flex-col gap-4 text-base leading-relaxed text-fg-secondary">
          <p>
            We compete as a D1 men&apos;s college ultimate program. Void won a national championship in 1985, and our alumni play at the highest levels of club ultimate and professionally in the UFA.
          </p>
          <p>
            There are two teams: Void, our A team, and Null, our B team. Void is competitive, but we don&apos;t cut from the program &ndash; anyone at Penn who wants to play on Null can. Null is where people learn the sport and fall for it; Void is where we compete at the highest level.
          </p>
          <p>
            New to ultimate? You&apos;re welcome. Reach us at{" "}
            <a href="mailto:void.ultimate@gmail.com" className="text-foreground underline underline-offset-4 hover:text-brand-text">
              void.ultimate@gmail.com
            </a>
            .
          </p>
        </div>
      </section>

      {recentEvents.length > 0 && (
        <section aria-labelledby="events-title" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="events-title" className="font-display text-4xl leading-none tracking-wide text-foreground">
              Recent events
            </h2>
            <Link href="/news" className="text-sm font-medium text-fg-secondary underline-offset-4 hover:text-foreground hover:underline">
              Read the news
            </Link>
          </div>
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
