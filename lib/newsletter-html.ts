import { PROSE_CSS, PROSE_CSS_LIGHT_OVERRIDES } from "@/lib/newsletter-prose-css"
import type { NewsletterItem } from "@/lib/aws/newsletters"

const THEMES = {
  dark: {
    pageBg:       "#0a0a0a",
    cardBg:       "#111111",
    cardBorder:   "#222222",
    divider:      "#1e1e1e",
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
    ? email
      ? `<table width="600" cellpadding="0" cellspacing="0" border="0" style="border-radius:12px 12px 0 0;overflow:hidden;">
          <tr>
            <td background="${coverUrl}" bgcolor="#111111" height="320" valign="bottom"
                style="background-image:url('${coverUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;border-radius:12px 12px 0 0;vertical-align:bottom;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td height="200" style="height:200px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td height="120" valign="bottom" bgcolor="#000000"
                      style="height:120px;background:linear-gradient(to top,rgba(0,0,0,0.95) 0%,rgba(0,0,0,0.7) 50%,transparent 100%);padding:0 32px 32px;text-align:center;vertical-align:bottom;">
                    <h1 style="margin:0 0 4px;font-size:36px;font-weight:900;color:#ffffff;line-height:1.2;">${newsletter.title}</h1>
                    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);">${dateLabel}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`
      : `<div style="position:relative;height:320px;overflow:hidden;border-radius:12px 12px 0 0;">
          <img src="${coverUrl}" alt="${newsletter.title}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;" />
          <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(to top,rgba(0,0,0,0.95) 0%,rgba(0,0,0,0.55) 40%,transparent 80%);"></div>
          <div style="position:absolute;bottom:0;left:0;right:0;padding:0 32px 32px;">
            <h1 style="margin:0 0 4px;font-size:36px;font-weight:900;color:#ffffff;line-height:1.2;text-shadow:0 2px 16px rgba(0,0,0,0.9),0 1px 4px rgba(0,0,0,0.8);">${newsletter.title}</h1>
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);text-shadow:0 1px 6px rgba(0,0,0,0.8);">${dateLabel}</p>
          </div>
        </div>`
    : ""

  const proseColor = theme === "dark" ? "rgba(255,255,255,0.85)" : "#333333"

  const headerBody = email && newsletter.emailBody ? newsletter.emailBody : newsletter.body
  const bodyHtml =
    headerBody && headerBody !== "<p></p>"
      ? `<div class="tiptap-prose" style="margin-bottom:32px;color:${proseColor};">${headerBody}</div>`
      : ""

  const entriesHtml = (newsletter.entries ?? []).map(entry => {
    const entryDate = entry.date
      ? `<p style="margin:0 0 20px;font-size:12px;color:${t.date};">${entry.date}</p>`
      : ""
    return `
      <div style="padding:32px 40px;border-bottom:1px solid ${t.divider};">
        <h2 style="margin:0 0 4px;font-size:18px;font-weight:700;color:${t.proseHeading};">${entry.title}</h2>
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

    ${entriesHtml ? `<div style="border-top:1px solid ${t.divider};">${entriesHtml}</div>` : ""}

    <div style="padding:24px 40px;background:${t.footerBg};border-top:1px solid ${t.divider};">
      <p style="margin:0;font-size:12px;color:${t.footer};text-align:center;">
        Void Ultimate &bull; ${dateLabel} &bull;
        <a href="{{amazonSESUnsubscribeUrl}}" style="color:${t.footer};">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>`
}
