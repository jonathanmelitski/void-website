import type { Metadata } from "next"
import { listNewsletters } from "@/lib/aws/newsletters"
import { NewsletterCard } from "@/components/newsletters/NewsletterCard"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "News | Void Ultimate",
  description: "Monthly newsletters from the Void Ultimate team.",
  openGraph: {
    title: "News | Void Ultimate",
    description: "Monthly newsletters from the Void Ultimate team.",
  },
}

export default async function NewsPage() {
  let newsletters: Awaited<ReturnType<typeof listNewsletters>> = []
  try { newsletters = (await listNewsletters()).filter(n => n.published) } catch { /* build-time */ }

  return (
    <div className="p-8 lg:px-16">
      <h1 className="text-4xl font-black mb-8">News</h1>
      {newsletters.length === 0 ? (
        <p className="text-white/50">No newsletters published yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {newsletters.map(newsletter => (
            <NewsletterCard key={newsletter.id} newsletter={newsletter} />
          ))}
        </div>
      )}
    </div>
  )
}
