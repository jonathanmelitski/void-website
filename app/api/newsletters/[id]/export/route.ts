import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getNewsletter } from "@/lib/aws/newsletters"
import { buildNewsletterHtml } from "@/lib/newsletter-html"

type Params = { params: Promise<{ id: string }> }

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
