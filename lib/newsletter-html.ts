import { PROSE_CSS, PROSE_CSS_LIGHT_OVERRIDES } from "@/lib/newsletter-prose-css"
import type { NewsletterItem } from "@/lib/aws/newsletters"
import {
  EMAIL_FONT_STACK,
  EMAIL_PALETTES,
  emailifyProse,
  escapeHtml,
  htmlToText,
} from "@/lib/email-html"

export function injectTracking(
  html: string,
  messageId: string,
  sendId: string
): { html: string; links: string[] } {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://voidultimate.com"
  const links: string[] = []

  // Rewrite href="http..." links (skip unsubscribe placeholder)
  const rewritten = html.replace(/href="(https?:\/\/[^"]+)"/g, (_match, url: string) => {
    if (url.includes("amazonSESUnsubscribeUrl")) return `href="${url}"`
    links.push(url)
    const encoded = encodeURIComponent(url)
    return `href="${base}/t/click?m=${messageId}&s=${sendId}&url=${encoded}"`
  })

  // Append tracking pixel before </body>
  const pixel = `<img src="${base}/t/open?m=${messageId}&s=${sendId}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`
  const withPixel = rewritten.replace("</body>", `${pixel}\n</body>`)

  return { html: withPixel, links }
}

const THEMES = {
  dark: {
    pageBg:       "#0a0a0a",
    cardBg:       "#111111",
    cardBorder:   "#222222",
    divider:      "#2e2e2e",
    footerBg:     "#0d0d0d",
    title:        "#ffffff",
    date:         "#666666",
    proseHeading: "#ffffff",
    footer:       "#444444",
    shadow:       "0 2px 24px rgba(0,0,0,0.6)",
  },
  light: {
    pageBg:       "#f5f5f5",
    cardBg:       "#ffffff",
    cardBorder:   "#e5e5e5",
    divider:      "#e5e5e5",
    footerBg:     "#fafafa",
    title:        "#111111",
    date:         "#999999",
    proseHeading: "#111111",
    footer:       "#aaaaaa",
    shadow:       "0 2px 12px rgba(0,0,0,0.08)",
  },
}

export function buildNewsletterHtml(
  newsletter: NewsletterItem,
  theme: "dark" | "light" = "dark",
  email = false,
  includeWebLink = false
): string {
  if (email) return buildEmailHtml(newsletter, theme, includeWebLink)

  const t = theme === "dark" ? THEMES.dark : THEMES.light

  const s3Base = process.env.NEXT_PUBLIC_S3_BASE_URL ?? ""
  const coverUrl = newsletter.coverPhotoKey ? `${s3Base}/${newsletter.coverPhotoKey}` : null

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://voidultimate.com"
  const webUrl = `${baseUrl}/news/${newsletter.slug ?? newsletter.id}`

  const dateLabel = new Date(newsletter.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const coverHtml = coverUrl
    ? `<div style="position:relative;height:320px;overflow:hidden;border-radius:12px 12px 0 0;">
          <img src="${coverUrl}" alt="${newsletter.title}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;" />
          <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(to top,rgba(0,0,0,0.95) 0%,rgba(0,0,0,0.55) 40%,transparent 80%);"></div>
          <div style="position:absolute;bottom:0;left:0;right:0;padding:0 32px 32px;">
            <h1 style="margin:0 0 4px;font-size:36px;font-weight:900;color:#ffffff;line-height:1.2;text-shadow:0 2px 16px rgba(0,0,0,0.9),0 1px 4px rgba(0,0,0,0.8);">${newsletter.title}</h1>
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);text-shadow:0 1px 6px rgba(0,0,0,0.8);">${dateLabel}</p>
          </div>
        </div>`
    : ""

  const proseColor = theme === "dark" ? "rgba(255,255,255,0.85)" : "#333333"

  const headerBody = newsletter.body
  const bodyHtml =
    headerBody && headerBody !== "<p></p>"
      ? `<div class="tiptap-prose" style="margin-bottom:32px;color:${proseColor};">${headerBody}</div>`
      : ""

  const entriesHtml = (newsletter.entries ?? []).map(entry => {
    const entryDate = entry.date
      ? `<p style="margin:0 0 20px;font-size:12px;color:${t.date};">${entry.date}</p>`
      : ""
    return `
      <div style="padding:32px 40px;border-bottom:2px solid ${t.divider};">
        <h2 style="margin:0 0 4px;font-size:22px;font-weight:800;color:${t.proseHeading};letter-spacing:-0.3px;">${entry.title}</h2>
        ${entryDate}
        <div class="tiptap-prose" style="color:${proseColor};">${entry.body}</div>
      </div>`
  }).join("")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${newsletter.title}</title>
</head>
<body style="margin:0;padding:0;background:${t.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <style>
    * { box-sizing: border-box; }
    ${PROSE_CSS}
    ${theme === "light" ? PROSE_CSS_LIGHT_OVERRIDES : ""}
  </style>
  ${includeWebLink ? `<div style="max-width:600px;margin:0 auto 8px;text-align:center;"><p style="margin:0;font-size:11px;color:#999999;">Having trouble viewing this email? <a href="${webUrl}" style="color:#999999;">View it on the web</a></p></div>` : ""}
  <div style="max-width:600px;margin:${includeWebLink ? "0" : "40px"} auto 40px;background:${t.cardBg};border:1px solid ${t.cardBorder};border-radius:12px;overflow:hidden;box-shadow:${t.shadow};text-align:center;">

    ${coverHtml || ""}

    ${!coverUrl ? `
    <div style="padding:40px 40px 24px;">
      <h1 style="margin:0 0 6px;font-size:28px;font-weight:800;color:${t.title};line-height:1.2;">${newsletter.title}</h1>
      <p style="margin:0;font-size:13px;color:${t.date};">${dateLabel}</p>
    </div>` : ""}

    ${bodyHtml ? `<div style="padding:32px 40px 24px;">${bodyHtml}</div>` : ""}

    ${entriesHtml ? `<div style="border-top:2px solid ${t.divider};">${entriesHtml}</div>` : ""}

    <div style="padding:24px 40px;background:${t.footerBg};border-top:2px solid ${t.divider};">
      <p style="margin:0;font-size:12px;color:${t.footer};text-align:center;">
        Void Ultimate &bull; ${dateLabel} &bull;
        <a href="{{amazonSESUnsubscribeUrl}}" style="color:${t.footer};">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>`
}

function emailDateLabel(date: string): string {
  // Stored as YYYY-MM-DD (UTC midnight); format in UTC so it never shifts a day.
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

/**
 * Email-client-safe newsletter HTML: a 600px table shell, the cover as a real <img> with the
 * title below it, and all prose styles inlined (renders the same with or without <style>).
 */
function buildEmailHtml(
  newsletter: NewsletterItem,
  theme: "dark" | "light",
  includeWebLink: boolean
): string {
  const t = theme === "dark" ? THEMES.dark : THEMES.light
  const p = EMAIL_PALETTES[theme]

  const s3Base = process.env.NEXT_PUBLIC_S3_BASE_URL ?? ""
  const coverUrl = newsletter.coverPhotoKey ? `${s3Base}/${newsletter.coverPhotoKey}` : null

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://voidultimate.com"
  const webUrl = `${baseUrl}/news/${newsletter.slug ?? newsletter.id}`

  const title = escapeHtml(newsletter.title)
  const dateLabel = emailDateLabel(newsletter.date)

  const coverRow = coverUrl
    ? `<tr><td style="padding:0;font-size:0;line-height:0;">
          <img src="${coverUrl}" width="600" alt="" border="0" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px 12px 0 0;" />
        </td></tr>`
    : ""

  const headerBody = newsletter.emailBody ? newsletter.emailBody : newsletter.body
  const bodyRow =
    headerBody && headerBody !== "<p></p>"
      ? `<tr><td class="nl-px" style="padding:24px 40px 32px;text-align:left;font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.6;color:${p.text};">
          ${emailifyProse(headerBody, p)}
        </td></tr>`
      : ""

  const entryRows = (newsletter.entries ?? []).map(entry => {
    const entryDate = entry.date
      ? `<p style="margin:0 0 20px;font-size:12px;color:${t.date};">${escapeHtml(entry.date)}</p>`
      : `<div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>`
    return `<tr><td class="nl-px" style="padding:32px 40px;border-top:2px solid ${t.divider};text-align:left;font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.6;color:${p.text};">
          <h2 style="margin:0 0 4px;font-size:22px;font-weight:800;line-height:1.3;color:${t.proseHeading};letter-spacing:-0.3px;">${escapeHtml(entry.title)}</h2>
          ${entryDate}
          ${emailifyProse(entry.body ?? "", p)}
        </td></tr>`
  }).join("")

  const webLinkRow = includeWebLink
    ? `<tr><td align="center" style="padding:0 0 8px;font-family:${EMAIL_FONT_STACK};">
          <p style="margin:0;font-size:11px;color:#999999;">Having trouble viewing this email? <a href="${webUrl}" style="color:#999999;text-decoration:underline;">View it on the web</a></p>
        </td></tr>`
    : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${title}</title>
  <style>
    /* Progressive enhancement only: every rule the email needs is inlined. */
    a:hover { opacity: 0.8; }
    @media only screen and (max-width: 620px) {
      .nl-px { padding-left: 20px !important; padding-right: 20px !important; }
      .nl-title { font-size: 28px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${t.pageBg};font-family:${EMAIL_FONT_STACK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.pageBg};">
    <tr><td align="center" style="padding:${includeWebLink ? "16px" : "40px"} 12px 40px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        ${webLinkRow}
        <tr><td style="padding:0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.cardBg}" style="width:100%;background:${t.cardBg};border:1px solid ${t.cardBorder};border-radius:12px;border-collapse:separate;">
            ${coverRow}
            <tr><td class="nl-px" align="center" style="padding:${coverUrl ? "28px" : "40px"} 40px 8px;text-align:center;font-family:${EMAIL_FONT_STACK};">
              <h1 class="nl-title" style="margin:0 0 6px;font-size:32px;font-weight:800;line-height:1.2;color:${t.title};">${title}</h1>
              <p style="margin:0;font-size:13px;color:${t.date};">${dateLabel}</p>
            </td></tr>
            ${bodyRow || `<tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>`}
            ${entryRows}
            <tr><td class="nl-px" align="center" style="padding:24px 40px;background:${t.footerBg};border-top:2px solid ${t.divider};border-radius:0 0 12px 12px;font-family:${EMAIL_FONT_STACK};">
              <p style="margin:0;font-size:12px;color:${t.footer};text-align:center;">
                Void Ultimate &bull; ${dateLabel} &bull;
                <a href="{{amazonSESUnsubscribeUrl}}" style="color:${t.footer};text-decoration:underline;">Unsubscribe</a>
              </p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/**
 * Plain-text alternative for the newsletter email (SES `Body.Text`). Same content as
 * buildNewsletterHtml(…, email=true): title, date, body, entries, web link, unsubscribe.
 */
export function buildNewsletterText(newsletter: NewsletterItem, includeWebLink = false): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://voidultimate.com"
  const webUrl = `${baseUrl}/news/${newsletter.slug ?? newsletter.id}`
  const dateLabel = emailDateLabel(newsletter.date)
  const parts: string[] = []
  if (includeWebLink) parts.push(`View it on the web: ${webUrl}`)
  parts.push(`${newsletter.title}\n${dateLabel}`)
  const headerBody = newsletter.emailBody ? newsletter.emailBody : newsletter.body
  if (headerBody && headerBody !== "<p></p>") parts.push(htmlToText(headerBody))
  for (const entry of newsletter.entries ?? []) {
    const heading = entry.date ? `${entry.title}\n${entry.date}` : entry.title
    parts.push(`----\n\n${heading}\n\n${htmlToText(entry.body ?? "")}`)
  }
  parts.push(`----\nVoid Ultimate • ${dateLabel}\nUnsubscribe: {{amazonSESUnsubscribeUrl}}`)
  return parts.join("\n\n") + "\n"
}
