import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { getNewsletter } from "@/lib/aws/newsletters"
import { buildNewsletterHtml } from "@/lib/newsletter-html"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params

  const auth = await requireUser(request, { permission: "newsletters.edit" })
  if (!auth.ok) return auth.response

  const newsletter = await getNewsletter(id)
  if (!newsletter) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const themeParam = request.nextUrl.searchParams.get("theme")
  const theme = themeParam === "light" ? "light" : "dark"
  const email = request.nextUrl.searchParams.get("email") === "true"
  const html = buildNewsletterHtml(newsletter, theme, email)

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${newsletter.slug ?? newsletter.id}.html"`,
    },
  })
}
