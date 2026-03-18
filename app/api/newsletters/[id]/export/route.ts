import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getNewsletter } from "@/lib/aws/newsletters"
import { PROSE_CSS, PROSE_CSS_LIGHT_OVERRIDES } from "@/lib/newsletter-prose-css"

type Params = { params: Promise<{ id: string }> }

const THEMES = {
  dark: {
    pageBg:        "#0a0a0a",
    cardBg:        "#111111",
    cardBorder:    "#222222",
    divider:       "#1e1e1e",
    footerBg:      "#0d0d0d",
    title:         "#ffffff",
    date:          "#666666",
    prose:         "rgba(255,255,255,0.85)",
    proseHeading:  "#ffffff",
    proseMuted:    "rgba(255,255,255,0.5)",
    blockquote:    "rgba(255,255,255,0.5)",
    blockquoteBg:  "rgba(255,255,255,0.08)",
    link:          "#7a52ff",
    codeBg:        "rgba(231,231,243,0.07)",
    codeColor:     "rgba(251,251,254,0.75)",
    codeBorder:    "rgba(238,238,246,0.11)",
    preBg:         "rgba(232,232,253,0.05)",
    preColor:      "rgba(253,253,253,0.88)",
    hr:            "rgba(255,255,255,0.1)",
    footer:        "#444444",
    shadow:        "0 2px 24px rgba(0,0,0,0.6)",
  },
  light: {
    pageBg:        "#f5f5f5",
    cardBg:        "#ffffff",
    cardBorder:    "#e5e5e5",
    divider:       "#e5e5e5",
    footerBg:      "#fafafa",
    title:         "#111111",
    date:          "#999999",
    prose:         "#333333",
    proseHeading:  "#111111",
    proseMuted:    "#888888",
    blockquote:    "#555555",
    blockquoteBg:  "transparent",
    link:          "#6B46FF",
    codeBg:        "#f0f0f5",
    codeColor:     "#333333",
    codeBorder:    "#e0e0e8",
    preBg:         "#f5f5f8",
    preColor:      "#333333",
    hr:            "#e5e5e5",
    footer:        "#aaaaaa",
    shadow:        "0 2px 12px rgba(0,0,0,0.08)",
  },
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const payload = await verifyToken(token)
    const groups: string[] = payload["cognito:groups"] ?? []
    if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const newsletter = await getNewsletter(id)
  if (!newsletter) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const themeParam = request.nextUrl.searchParams.get("theme")
  const t = themeParam === "light" ? THEMES.light : THEMES.dark

  const s3Base = process.env.NEXT_PUBLIC_S3_BASE_URL ?? ""
  const coverUrl = newsletter.coverPhotoKey ? `${s3Base}/${newsletter.coverPhotoKey}` : null

  const dateLabel = new Date(newsletter.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const coverHtml = coverUrl
    ? `<div style="position:relative;height:240px;overflow:hidden;border-radius:8px 8px 0 0;margin-bottom:0;">
        <img src="${coverUrl}" alt="${newsletter.title}" style="width:100%;height:100%;object-fit:cover;object-position:center;display:block;" />
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.8) 0%,rgba(0,0,0,0.1) 50%,transparent 100%);"></div>
        <div style="position:absolute;bottom:0;left:0;right:0;padding:24px 32px;">
          <h1 style="margin:0 0 4px;font-size:28px;font-weight:800;color:#ffffff;line-height:1.2;text-shadow:0 2px 8px rgba(0,0,0,0.5);">${newsletter.title}</h1>
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);">${dateLabel}</p>
        </div>
      </div>`
    : ""

  const bodyHtml =
    newsletter.body && newsletter.body !== "<p></p>"
      ? `<div class="tiptap-prose" style="margin-bottom:32px;">${newsletter.body}</div>`
      : ""

  const entriesHtml = (newsletter.entries ?? []).map(entry => {
    const entryDate = entry.date
      ? `<p style="margin:0 0 20px;font-size:12px;color:${t.date};">${entry.date}</p>`
      : ""
    return `
      <div style="padding:32px 40px;border-bottom:1px solid ${t.divider};">
        <h2 style="margin:0 0 4px;font-size:18px;font-weight:700;color:${t.proseHeading};">${entry.title}</h2>
        ${entryDate}
        <div class="tiptap-prose">${entry.body}</div>
      </div>`
  }).join("")

  const isLight = themeParam === "light"

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${newsletter.title}</title>
  <style>
    body { margin: 0; padding: 0; background: ${t.pageBg}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    * { box-sizing: border-box; }
    ${PROSE_CSS}
    ${isLight ? PROSE_CSS_LIGHT_OVERRIDES : ""}
  </style>
</head>
<body>
  <div style="max-width:600px;margin:40px auto;background:${t.cardBg};border:1px solid ${t.cardBorder};border-radius:12px;overflow:hidden;box-shadow:${t.shadow};text-align:center;">

    ${coverHtml || ""}

    ${!coverUrl ? `
    <div style="padding:40px 40px 24px;">
      <h1 style="margin:0 0 6px;font-size:28px;font-weight:800;color:${t.title};line-height:1.2;">${newsletter.title}</h1>
      <p style="margin:0;font-size:13px;color:${t.date};">${dateLabel}</p>
    </div>` : ""}

    ${bodyHtml ? `<div style="padding:32px 40px 24px;">${bodyHtml}</div>` : ""}

    ${entriesHtml ? `<div style="border-top:1px solid ${t.divider};">${entriesHtml}</div>` : ""}

    <div style="padding:24px 40px;background:${t.footerBg};border-top:1px solid ${t.divider};">
      <p style="margin:0;font-size:12px;color:${t.footer};text-align:center;">Void Ultimate &bull; ${dateLabel}</p>
    </div>

  </div>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${newsletter.slug ?? newsletter.id}.html"`,
    },
  })
}
