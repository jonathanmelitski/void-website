import * as newsletterHtml from "@/lib/newsletter-html"
import type { NewsletterItem } from "@/lib/aws/newsletters"

// TODO(merge): `buildNewsletterText` comes with the email-images change in lib/newsletter-html.ts.
// Once both are merged, callers can import it directly and this wrapper can go.
type TextBuilder = (newsletter: NewsletterItem, includeWebLink?: boolean) => string

/** Plain-text alternative for SES `Body.Text` (keeps the {{amazonSESUnsubscribeUrl}} placeholder), if available. */
export function newsletterTextBody(newsletter: NewsletterItem, includeWebLink?: boolean): { Text: { Data: string } } | Record<string, never> {
  const build = (newsletterHtml as unknown as { buildNewsletterText?: TextBuilder }).buildNewsletterText
  return typeof build === "function" ? { Text: { Data: build(newsletter, includeWebLink) } } : {}
}
