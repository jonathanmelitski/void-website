import matter from "gray-matter"
import { marked } from "marked"

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const NEWSLETTER_TEMPLATE = `---
# ── Required fields ─────────────────────────────────────────────────────────
title: My Newsletter Title
date: 2026-03-01
# ────────────────────────────────────────────────────────────────────────────
---

<!-- ═══════════════════════════════════════════════════════════════════════════
     NEWSLETTER BODY
     Content in this section appears at the top of the newsletter page,
     before any entries. Standard markdown is supported: **bold**, *italic*,
     [links](https://example.com), \`code\`, blockquotes, and lists.
     ═══════════════════════════════════════════════════════════════════════════ -->

Welcome to this month's newsletter! Write your introduction here.

You can use **bold**, *italic*, lists, and any other standard markdown.

<!-- ═══════════════════════════════════════════════════════════════════════════
     ENTRIES
     Each ## heading below becomes a separate newsletter entry.
     Add as many ## sections as you need — there is no limit.

     Within each entry you may use unlimited subheadings (###, ####, …),
     bold, italic, links, code blocks, blockquotes, and lists.

     To attach an optional display date to an entry, place the special comment
       <!-- entry-date: Month YYYY -->
     anywhere inside that entry's section (it will not appear in the output).
     ═══════════════════════════════════════════════════════════════════════════ -->

## First Entry Title
<!-- entry-date: March 2026 -->

Entry content goes here. You can write as much as you like using standard
markdown formatting.

### A Subheading Within This Entry

Subheadings (###) and deeper levels (####, …) are fully supported inside
each entry and will render correctly on the newsletter page.

## Second Entry Title

This entry has no date attached. Add as many ## sections as you need below.

### Section One

Content for section one.

### Section Two

Content for section two.
`

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export type ParsedEntry = {
  title: string
  date?: string
  body: string // HTML
}

export type ParsedTemplate = {
  title: string
  date: string
  body: string // HTML
  entries: ParsedEntry[]
}

const ENTRY_DATE_RE = /<!--\s*entry-date:\s*(.+?)\s*-->/i

/** Convert markdown to HTML using marked (synchronous renderer). */
function toHtml(md: string): string {
  return marked.parse(md.trim(), { async: false }) as string
}

/**
 * Parse a newsletter markdown template into structured data.
 * Throws if required frontmatter fields (title, date) are missing.
 */
export function parseNewsletterTemplate(markdown: string): ParsedTemplate {
  const { data, content } = matter(markdown)

  if (!data.title || typeof data.title !== "string") {
    throw new Error("Template is missing a required frontmatter field: title")
  }
  if (!data.date) {
    throw new Error("Template is missing a required frontmatter field: date")
  }

  const title = String(data.title).trim()
  // gray-matter may parse YYYY-MM-DD dates as Date objects
  const date =
    data.date instanceof Date
      ? data.date.toISOString().slice(0, 10)
      : String(data.date).trim()

  // Split on ## headings (entry boundaries)
  const sections = content.split(/^(?=## )/m)

  // Everything before the first ## is the newsletter body
  const bodyMd = sections.shift() ?? ""
  const body = toHtml(bodyMd)

  const entries: ParsedEntry[] = sections.map(section => {
    const lines = section.split("\n")
    const entryTitle = (lines[0] ?? "").replace(/^##\s+/, "").trim()
    const rest = lines.slice(1).join("\n")

    // Extract entry-date comment, then remove it from the body markdown
    const dateMatch = ENTRY_DATE_RE.exec(rest)
    const entryDate = dateMatch ? dateMatch[1].trim() : undefined
    const bodyMdClean = rest.replace(ENTRY_DATE_RE, "")

    return {
      title: entryTitle,
      date: entryDate,
      body: toHtml(bodyMdClean),
    }
  })

  return { title, date, body, entries }
}
