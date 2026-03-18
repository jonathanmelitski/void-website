import type { Metadata } from "next"
import type { NewsletterItem } from "@/lib/aws/newsletters"
import { NewsletterCard } from "@/components/newsletters/NewsletterCard"

export const metadata: Metadata = {
  title: "News | Void Ultimate",
  description: "Monthly newsletters from the Void Ultimate team.",
  openGraph: {
    title: "News | Void Ultimate",
    description: "Monthly newsletters from the Void Ultimate team.",
  },
}

async function getNewsletters(): Promise<NewsletterItem[]> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/newsletters`, { cache: "no-store" })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export default async function NewsPage() {
  const newsletters = await getNewsletters()

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
