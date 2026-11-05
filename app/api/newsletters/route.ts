import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import {
  listNewsletters,
  createNewsletter,
  generateSlug,
  type NewsletterItem,
} from "@/lib/aws/newsletters"
import { logAudit } from "@/lib/aws/audit"
import { randomUUID } from "crypto"



export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const all = searchParams.get("all") === "true"

  if (all) {
    const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
    if (!auth.ok) return auth.response
    const newsletters = await listNewsletters()
    return NextResponse.json(newsletters)
  }

  const newsletters = await listNewsletters()
  return NextResponse.json(newsletters.filter(n => n.published))
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const callerUsername = auth.username

  const body = await request.json()
  const { title, date, coverPhotoKey, slug: rawSlug } = body

  if (!title || !date) {
    return NextResponse.json({ error: "title and date are required" }, { status: 400 })
  }

  const item: NewsletterItem = {
    id: randomUUID(),
    slug: rawSlug ? String(rawSlug) : generateSlug(title),
    title,
    date,
    coverPhotoKey,
    published: false,
    entries: [],
    createdAt: new Date().toISOString(),
  }

  await createNewsletter(item)
  void logAudit({
    actorUsername: callerUsername,
    action: "CREATE",
    entityType: "NEWSLETTER",
    entityId: item.id,
    entityLabel: item.title,
    newState: item as Record<string, unknown>,
    reversible: true,
  })
  return NextResponse.json(item, { status: 201 })
}
