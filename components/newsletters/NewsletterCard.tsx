import Link from "next/link"
import Image from "next/image"
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
        <div className="bg-white/10 backdrop-blur-sm rounded-lg overflow-hidden">
          <div className="relative aspect-[4/3] flex items-center justify-center text-white/40 text-sm">
            <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
              <h3 className="font-bold text-lg leading-tight">{newsletter.title}</h3>
              <p className="text-sm text-white/80 mt-0.5">{dateLabel}</p>
            </div>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={`/news/${newsletter.slug ?? newsletter.id}`} className="block group">
      <div className="bg-white/10 backdrop-blur-sm rounded-lg overflow-hidden">
        <div className="relative aspect-[4/3] hover:scale-[1.02] transition-transform">
          <Image
            src={coverUrl}
            alt={newsletter.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
            <h3 className="font-bold text-lg leading-tight">{newsletter.title}</h3>
            <p className="text-sm text-white/80 mt-0.5">{dateLabel}</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
