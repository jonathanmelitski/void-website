import type { Metadata } from "next"
import { listNewsletters } from "@/lib/aws/newsletters"
import Link from "next/link"
import { Newspaper } from "lucide-react"
import { NewsletterCard } from "@/components/newsletters/NewsletterCard"
import { PageContainer, PageHeader } from "@/components/ui/page"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

// ISR: the newsletters Scan (~0.5 s) runs at most once a minute, not on every view.
// Publish/unpublish/delete also revalidate "/news" on demand.
export const revalidate = 60

export const metadata: Metadata = {
  title: "News",
  description: "Monthly newsletters from the Void Ultimate team.",
  openGraph: {
    title: "News",
    description: "Monthly newsletters from the Void Ultimate team.",
  },
}

export default async function NewsPage() {
  let newsletters: Awaited<ReturnType<typeof listNewsletters>> = []
  try {
    newsletters = (await listNewsletters()).filter(n => n.published)
  } catch (err) {
    // Build time (no AWS access): render empty, ISR fills it in. At runtime rethrow so a failed
    // regeneration keeps the last good page instead of caching "No newsletters" for a minute.
    if (process.env.NEXT_PHASE !== "phase-production-build") throw err
  }

  return (
    <PageContainer>
      <PageHeader
        title="News"
        description="Monthly newsletters from the team: results, recaps and what's coming up."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/subscribe/void-public">Get it by email</Link>
          </Button>
        }
      />
      {newsletters.length === 0 ? (
        <EmptyState
          variant="page"
          icon={<Newspaper />}
          title="No newsletters yet"
          description="The first issue is on its way. Subscribe to get it in your inbox."
          action={
            <Button asChild size="sm">
              <Link href="/subscribe/void-public">Subscribe</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {newsletters.map(newsletter => (
            <NewsletterCard key={newsletter.id} newsletter={newsletter} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
