/**
 * Email-safe post-processing for newsletter HTML (tiptap output).
 *
 * Mail clients drop or mangle <style> blocks (Gmail discards ones it can't parse, many strip
 * @import, Outlook's Word engine ignores max-width), so everything the email needs is written
 * as inline styles / attributes here. Pure string functions, no DOM: safe on the server.
 */

/** Usable content width inside the 600px card (40px side padding). */
export const EMAIL_CONTENT_WIDTH = 520

export type EmailPalette = {
  text: string
  heading: string
  link: string
  quoteBar: string
  quoteText: string
  codeBg: string
  codeText: string
  codeBorder: string
  preBg: string
  hr: string
}

export const EMAIL_PALETTES: Record<"light" | "dark", EmailPalette> = {
  light: {
    text: "#333333",
    heading: "#111111",
    link: "#6B46FF",
    quoteBar: "#cccccc",
    quoteText: "#555555",
    codeBg: "#f0f0f5",
    codeText: "#333333",
    codeBorder: "#e0e0e8",
    preBg: "#f5f5f8",
    hr: "#e5e5e5",
  },
  dark: {
    text: "#d9d9d9",
    heading: "#ffffff",
    link: "#9d8aff",
    quoteBar: "#5c5c5c",
    quoteText: "#b3b3b3",
    codeBg: "#1c1c22",
    codeText: "#e6e6ea",
    codeBorder: "#2e2e36",
    preBg: "#17171c",
    hr: "#2e2e2e",
  },
}

export const EMAIL_FONT_STACK =
  "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// ── attribute helpers ────────────────────────────────────────────────────────

const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function parseAttrs(tag: string): Map<string, string> {
  const inner = tag.replace(/^<\s*[a-zA-Z0-9]+/, "").replace(/\/?>$/, "")
  const attrs = new Map<string, string>()
  for (const m of inner.matchAll(ATTR_RE)) {
    attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "")
  }
  return attrs
}

function serializeAttrs(attrs: Map<string, string>): string {
  let out = ""
  for (const [k, v] of attrs) out += ` ${k}="${v.replace(/"/g, "&quot;")}"`
  return out
}

/** Parses a stored width ("694", "694px", 694) to a positive integer, or null. */
export function parseImageWidth(width: unknown): number | null {
  if (width == null) return null
  const n = parseInt(String(width), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Camera / OS filenames that the uploader used to store as alt text ("8D6A9674",
// "IMG_1234", "Screenshot 2026-05-01 at 1.19.36 PM"). These are noise for readers
// and screen readers, so treat the image as decorative instead.
const FILENAME_ALT_RES = [
  /^screen ?shot\b/i,
  /^(img|dsc[nf]?|pxl|mvimg|gopr|dji|image|photo|untitled|whatsapp image)([\s_-]?\d|$)/i,
  /^[\w-]*\d{3,}[\w-]*$/, // single token containing a run of digits
  /\.(jpe?g|png|gif|heic|heif|webp|tiff?)$/i,
]

export function cleanImageAlt(alt: string | undefined | null): string {
  const a = (alt ?? "").trim()
  if (!a) return ""
  const base = a.replace(/\s*(\(\d+\)|copy)$/i, "") // "8D6A9877 (1)", "IMG_1 copy"
  return FILENAME_ALT_RES.some(re => re.test(base)) ? "" : a
}

// ── images ───────────────────────────────────────────────────────────────────

/**
 * Rewrites every <img> for email: integer width ≤ maxWidth, inline
 * max-width:100%;height:auto;display:block, cleaned alt, alignment via a wrapping
 * presentation table (Outlook ignores auto margins). Legacy width="694px" is handled.
 */
export function emailifyImages(html: string, maxWidth = EMAIL_CONTENT_WIDTH): string {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const a = parseAttrs(tag)
    const src = a.get("src")
    if (!src) return ""
    const stored = parseImageWidth(a.get("width"))
    const width = Math.min(stored ?? maxWidth, maxWidth)
    const align = a.get("data-align") === "center" ? "center" : a.get("data-align") === "right" ? "right" : "left"
    const alt = cleanImageAlt(a.get("alt")).replace(/"/g, "&quot;") // raw attribute text: already HTML-encoded
    const img =
      `<img src="${src}" width="${width}" alt="${alt}" border="0"` +
      ` style="display:block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;border-radius:6px;` +
      `${align === "center" ? "margin:0 auto;" : align === "right" ? "margin:0 0 0 auto;" : "margin:0;"}" />`
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">` +
      `<tr><td align="${align}" style="padding:24px 0;">${img}</td></tr></table>`
    )
  })
}

/**
 * Web rendering of stored body HTML (/news): lazy-load + async-decode images and normalise
 * legacy width="694px" to an integer. Height is unknown (not stored), so CSS keeps height:auto.
 */
export function webifyImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const a = parseAttrs(tag)
    if (!a.get("src")) return ""
    const w = parseImageWidth(a.get("width"))
    if (w) a.set("width", String(w))
    else a.delete("width")
    a.set("alt", cleanImageAlt(a.get("alt"))) // raw attribute text: already HTML-encoded
    a.delete("title")
    a.set("loading", "lazy")
    a.set("decoding", "async")
    return `<img${serializeAttrs(a)} />`
  })
}

// ── prose inlining ───────────────────────────────────────────────────────────

const VOID_TAGS = new Set(["img", "br", "hr", "input", "meta", "link", "source", "wbr", "col"])

function proseStyle(tag: string, first: boolean, ctx: Set<string>, p: EmailPalette): string | null {
  const mt = (v: string) => (first ? "0" : v)
  switch (tag) {
    case "p":
      if (ctx.has("li")) return `margin:0;line-height:1.6;`
      if (ctx.has("blockquote")) return `margin:0;font-size:16px;line-height:1.6;color:${p.quoteText};`
      return `margin:${mt("20px")} 0 0;font-size:16px;line-height:1.6;color:${p.text};`
    case "h1":
      return `margin:${mt("48px")} 0 0;font-size:24px;font-weight:700;line-height:1.2;color:${p.heading};`
    case "h2":
      return `margin:${mt("40px")} 0 0;font-size:20px;font-weight:700;line-height:1.3;color:${p.heading};`
    case "h3":
      return `margin:${mt("32px")} 0 0;font-size:18px;font-weight:600;line-height:1.4;color:${p.heading};`
    case "h4":
    case "h5":
    case "h6":
      return `margin:${mt("32px")} 0 0;font-size:16px;font-weight:600;line-height:1.4;color:${p.heading};`
    case "ul":
    case "ol":
      if (ctx.has("li")) return `margin:0;padding-left:24px;`
      return `margin:${mt("24px")} 0 24px;padding-left:24px;color:${p.text};font-size:16px;line-height:1.6;`
    case "li":
      return `margin:0 0 4px;`
    case "blockquote":
      return `margin:24px 0;padding:6px 0 6px 16px;border-left:4px solid ${p.quoteBar};color:${p.quoteText};`
    case "a":
      return `color:${p.link};text-decoration:underline;`
    case "pre":
      return `margin:24px 0;padding:16px;background:${p.preBg};color:${p.codeText};border:1px solid ${p.codeBorder};border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;`
    case "code":
      if (ctx.has("pre")) return `background:transparent;border:0;padding:0;font-family:inherit;font-size:inherit;`
      return `background:${p.codeBg};color:${p.codeText};border:1px solid ${p.codeBorder};border-radius:6px;padding:1px 4px;font-family:Menlo,Consolas,monospace;font-size:14px;`
    case "hr":
      return `border:0;border-top:1px solid ${p.hr};margin:32px 0;height:0;`
    case "mark":
      return `padding:0 2px;`
    default:
      return null
  }
}

/**
 * Inlines the newsletter prose styles (equivalent of PROSE_CSS + light overrides) directly
 * onto each element, so the email renders the same with or without a <style> block.
 * Existing inline styles (e.g. text-align from the editor) are kept and take precedence.
 */
export function inlineProseStyles(html: string, palette: EmailPalette): string {
  type Frame = { tag: string; hasChild: boolean }
  const stack: Frame[] = [{ tag: "#root", hasChild: false }]
  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (whole, close: string, rawTag: string) => {
    const tag = rawTag.toLowerCase()
    if (close) {
      const idx = stack.map(f => f.tag).lastIndexOf(tag)
      if (idx > 0) stack.length = idx
      return whole
    }
    const parent = stack[stack.length - 1]
    const first = !parent.hasChild
    parent.hasChild = true
    const ctx = new Set(stack.map(f => f.tag))
    const style = proseStyle(tag, first, ctx, palette)
    const selfClosing = VOID_TAGS.has(tag) || whole.endsWith("/>")
    if (!selfClosing) stack.push({ tag, hasChild: false })
    if (!style || tag === "img") return whole
    const attrs = parseAttrs(whole)
    const existing = attrs.get("style")
    attrs.set("style", existing ? `${style}${existing.trim().replace(/;?$/, ";")}` : style)
    return `<${tag}${serializeAttrs(attrs)}${selfClosing ? " /" : ""}>`
  })
}

/** Full email treatment for one prose fragment. */
export function emailifyProse(html: string, palette: EmailPalette, maxImageWidth = EMAIL_CONTENT_WIDTH): string {
  return emailifyImages(inlineProseStyles(html, palette), maxImageWidth)
}

// ── plain text ───────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", bull: "•", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Converts a tiptap HTML fragment to readable plain text (links as "text (url)"). */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim()
      if (!href || href.startsWith("#")) return label
      return label && label !== href ? `${label} (${href})` : href
    })
    .replace(/<img\b[^>]*>/gi, tag => {
      const alt = cleanImageAlt(parseAttrs(tag).get("alt"))
      return alt ? `[${alt}]` : ""
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n----\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|h[1-6]|blockquote|pre|ul|ol|div|table|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
  s = decodeEntities(s)
  return s
    .split("\n")
    .map(l => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
