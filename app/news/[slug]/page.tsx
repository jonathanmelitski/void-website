import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Image from "next/image"
import type { NewsletterItem } from "@/lib/aws/newsletters"
import { PROSE_CSS } from "@/lib/newsletter-prose-css"

type Props = { params: Promise<{ slug: string }> }

async function getNewsletter(slug: string): Promise<NewsletterItem | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/newsletters/slug/${slug}`, { cache: "no-store" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const newsletter = await getNewsletter(slug)
  if (!newsletter) return { title: "Not Found" }
  const description = "Read this newsletter from Void Ultimate"
  const coverUrl = newsletter.coverPhotoKey
    ? `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${newsletter.coverPhotoKey}`
    : undefined
  return {
    title: `${newsletter.title} | Void Ultimate`,
    description,
    openGraph: {
      title: newsletter.title,
      description,
      ...(coverUrl ? { images: [coverUrl] } : {}),
    },
  }
}

export default async function NewsletterDetailPage({ params }: Props) {
  const { slug } = await params
  const newsletter = await getNewsletter(slug)
  if (!newsletter) notFound()

  const s3Base = process.env.NEXT_PUBLIC_S3_BASE_URL ?? ""
  const coverUrl = newsletter.coverPhotoKey ? `${s3Base}/${newsletter.coverPhotoKey}` : null
  const dateLabel = new Date(newsletter.date).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  })

  return (
    <>
      <style>{PROSE_CSS}</style>

      {/* Hero */}
      <div className="w-full px-4 sm:px-8 lg:px-16 pt-8 mb-10">
        {coverUrl ? (
          <div className="relative h-64 sm:h-80 rounded-xl overflow-hidden">
            <Image src={coverUrl} alt={newsletter.title} fill className="object-cover object-center" priority />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute bottom-0 inset-x-0 px-8 pb-8">
              <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-1 drop-shadow-lg">{newsletter.title}</h1>
              <p className="text-white/60 text-sm">{dateLabel}</p>
            </div>
          </div>
        ) : (
          <div className="pt-2">
            <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-2">{newsletter.title}</h1>
            <p className="text-white/40 text-sm">{dateLabel}</p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="w-full px-4 sm:px-8 lg:px-16 pb-10">
        {newsletter.body && newsletter.body !== "<p></p>" && (
          <div className="tiptap-prose mb-10" dangerouslySetInnerHTML={{ __html: newsletter.body }} />
        )}

        {(newsletter.entries ?? []).length > 0 && (
          <div className="bg-white/[0.06] backdrop-blur-2xl border border-white/10 rounded-2xl divide-y divide-white/10 overflow-hidden">
            {newsletter.entries.map(entry => (
              <article key={entry.id} className="px-6 sm:px-10 py-8">
                <h2 className="text-xl sm:text-2xl font-bold mb-1">{entry.title}</h2>
                {entry.date && <p className="text-white/35 text-xs mb-6">{entry.date}</p>}
                <div className="tiptap-prose" dangerouslySetInnerHTML={{ __html: entry.body }} />
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="w-full px-4 sm:px-8 lg:px-16 py-10 mt-6 border-t border-white/[0.06]">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-white/25 text-xs">
          <span className="font-semibold tracking-widest uppercase text-white/40">Void Ultimate</span>
          <span>{dateLabel}</span>
          <a href="/news" className="hover:text-white/50 transition-colors">← All newsletters</a>
        </div>
      </footer>
    </>
  )
}
