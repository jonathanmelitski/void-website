import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { NewsletterCover } from "@/components/newsletters/NewsletterCover"
import { webifyImages } from "@/lib/email-html"
import { getNewsletterBySlug } from "@/lib/aws/newsletters"
import type { NewsletterItem } from "@/lib/aws/newsletters"
import { PROSE_CSS } from "@/lib/newsletter-prose-css"
import { formatDate, toDateTimeAttr } from "@/lib/format-date"
import { Button } from "@/components/ui/button"

// Page-local theme overrides on top of the shared newsletter CSS (which is written for dark
// email/preview contexts): theme tokens so the article reads in light and dark.
const ARTICLE_CSS = `
  .news-article .tiptap-prose { color: var(--fg-secondary); font-size: 1.0625rem; line-height: 1.7; }
  .news-article .tiptap-prose p { font-size: inherit; line-height: inherit; }
  .news-article .tiptap-prose h1, .news-article .tiptap-prose h2,
  .news-article .tiptap-prose h3, .news-article .tiptap-prose h4 { color: var(--foreground); }
  .news-article .tiptap-prose a { color: var(--brand-text); text-underline-offset: 3px; }
  .news-article .tiptap-prose a:hover { color: var(--foreground); }
  .news-article .tiptap-prose blockquote::before { background-color: var(--border-strong); }
  .news-article .tiptap-prose hr { border-top-color: var(--border); }
  .news-article .tiptap-prose code, .news-article .tiptap-prose pre {
    background-color: var(--surface-2); color: var(--foreground); border-color: var(--border);
  }
`

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  let newsletter: NewsletterItem | null = null
  try { newsletter = await getNewsletterBySlug(slug) } catch { /* build-time */ }
  if (!newsletter) return { title: "Not Found" }
  const description = "Read this newsletter from Void Ultimate"
  const coverUrl = newsletter.coverPhotoKey
    ? `${process.env.NEXT_PUBLIC_S3_BASE_URL}/${newsletter.coverPhotoKey}`
    : undefined
  return {
    title: newsletter.title,
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
  let newsletter: NewsletterItem | null = null
  try { newsletter = await getNewsletterBySlug(slug) } catch { /* env not available */ }
  if (!newsletter || !newsletter.published) return notFound()

  const s3Base = process.env.NEXT_PUBLIC_S3_BASE_URL ?? ""
  const coverUrl = newsletter.coverPhotoKey ? `${s3Base}/${newsletter.coverPhotoKey}` : null
  const dateLabel = formatDate(newsletter.date)
  const dateAttr = toDateTimeAttr(newsletter.date)

  return (
    <article className="news-article mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 md:pt-10 lg:px-8">
      <style>{PROSE_CSS}</style>
      <style>{ARTICLE_CSS}</style>

      <Link
        href="/news"
        className="mb-6 inline-flex h-10 items-center gap-1.5 rounded-md text-sm font-medium text-fg-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All newsletters
      </Link>

      {/* Hero */}
      <header className="mb-10">
        {coverUrl ? (
          <div className="relative h-64 sm:h-80 rounded-xl overflow-hidden">
            <NewsletterCover src={coverUrl} sizes="100vw" priority />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute bottom-0 inset-x-0 px-6 pb-6 sm:px-8 sm:pb-8 text-white">
              <h1 className="text-4xl sm:text-5xl font-display tracking-wide leading-none mb-1 drop-shadow-lg">{newsletter.title}</h1>
              {dateLabel && <p className="text-white/80 text-sm"><time dateTime={dateAttr}>{dateLabel}</time></p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-b border-border pb-8">
            <h1 className="text-5xl sm:text-6xl font-display tracking-wide leading-[0.9] text-foreground">{newsletter.title}</h1>
            {dateLabel && <p className="text-fg-muted text-sm"><time dateTime={dateAttr}>{dateLabel}</time></p>}
          </div>
        )}
      </header>

      {/* Content */}
      {newsletter.body && newsletter.body !== "<p></p>" && (
        <div className="tiptap-prose mb-12 max-w-[68ch]" dangerouslySetInnerHTML={{ __html: webifyImages(newsletter.body) }} />
      )}

      {(newsletter.entries ?? []).length > 0 && (
        <div className="flex flex-col divide-y divide-border border-t border-border">
          {newsletter.entries.map(entry => (
            <section key={entry.id} aria-labelledby={`entry-${entry.id}`} className="py-10">
              <h2 id={`entry-${entry.id}`} className="text-3xl sm:text-4xl font-display leading-none tracking-wide text-foreground">{entry.title}</h2>
              {entry.date && <p className="mt-2 text-fg-muted text-sm">{entry.date}</p>}
              <div className="tiptap-prose mt-6 max-w-[68ch]" dangerouslySetInnerHTML={{ __html: webifyImages(entry.body) }} />
            </section>
          ))}
        </div>
      )}

      {/* Next steps */}
      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Get the next issue</h2>
          <p className="text-sm text-fg-muted">Newsletters land in your inbox about once a month.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/subscribe/void-public">Subscribe</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/news">All newsletters</Link>
          </Button>
        </div>
      </div>
    </article>
  )
}
