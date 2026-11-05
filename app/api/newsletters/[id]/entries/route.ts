import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { appendNewsletterEntry, updateNewsletterEntries, getNewsletter } from "@/lib/aws/newsletters"
import { logAudit } from "@/lib/aws/audit"
import { randomUUID } from "crypto"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { username } = auth

  const { title, body, date } = await request.json()
  if (!title || !body) {
    return NextResponse.json({ error: "title and body are required" }, { status: 400 })
  }

  const entry = {
    id: randomUUID(),
    title,
    body,
    date: date ?? null,
    authorUsername: username,
    createdAt: new Date().toISOString(),
  }

  await appendNewsletterEntry(id, entry)
  void logAudit({
    actorUsername: username,
    action: "ENTRY_ADD",
    entityType: "NEWSLETTER_ENTRY",
    entityId: id,
    entityLabel: entry.title,
    newState: { entryId: entry.id, entry },
    reversible: true,
  })
  const newsletter = await getNewsletter(id)
  return NextResponse.json(newsletter, { status: 201 })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { entries } = await request.json()
  await updateNewsletterEntries(id, entries)
  return NextResponse.json({ success: true })
}
