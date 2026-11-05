import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { getNewsletter, removeNewsletterEntry } from "@/lib/aws/newsletters"

type Params = { params: Promise<{ id: string; entryId: string }> }

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, entryId } = await params
  // Any signed-in user; ownership (author or ADMIN) is checked below.
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { username, groups } = auth

  const newsletter = await getNewsletter(id)
  if (!newsletter) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const entry = newsletter.entries?.find(e => e.id === entryId)
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 })

  const isAdmin = groups.includes("ADMIN")
  const isAuthor = entry.authorUsername === username

  if (!isAdmin && !isAuthor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await removeNewsletterEntry(id, entryId)
  return NextResponse.json({ success: true })
}
