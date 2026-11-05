import Link from "next/link"
import { NewsletterCover } from "@/components/newsletters/NewsletterCover"
import type { NewsletterItem } from "@/lib/aws/newsletters"

interface NewsletterCardProps {
  newsletter: NewsletterItem
}

export function NewsletterCard({ newsletter }: NewsletterCardProps) {
  const coverUrl = newsletter.coverPhotoKey
    ? `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${newsletter.coverPhotoKey}`
    : null

  const dateLabel = new Date(newsletter.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  if (!coverUrl) {
    return (
      <Link href={`/news/${newsletter.slug ?? newsletter.id}`} className="block group">
        <div className="bg-surface border border-border rounded-xl overflow-hidden transition-colors group-hover:bg-surface-2">
          <div className="relative aspect-[4/3] flex items-center justify-center text-fg-muted text-sm">
            <div className="absolute bottom-0 left-0 right-0 p-4 text-foreground">
              <h2 className="font-semibold text-lg leading-tight">{newsletter.title}</h2>
              <p className="text-sm text-fg-secondary mt-0.5">{dateLabel}</p>
            </div>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={`/news/${newsletter.slug ?? newsletter.id}`} className="block group">
      <div className="bg-white/10 backdrop-blur-sm rounded-xl overflow-hidden">
        <div className="relative aspect-[4/3] hover:scale-[1.02] transition-transform">
          <NewsletterCover
            src={coverUrl}
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
            <h2 className="font-semibold text-lg leading-tight">{newsletter.title}</h2>
            <p className="text-sm text-white/90 mt-0.5">{dateLabel}</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
