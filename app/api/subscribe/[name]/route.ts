import { NextRequest, NextResponse } from "next/server"
import { listContacts, createContact } from "@/lib/aws/ses"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const { email } = await request.json().catch(() => ({}))

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 })
  }

  const contacts = await listContacts(name).catch(() => null)
  if (contacts === null) {
    return NextResponse.json({ error: "List not found" }, { status: 404 })
  }

  const existing = contacts.find(c => c.email.toLowerCase() === email.toLowerCase())
  if (existing && !existing.unsubscribed) {
    return NextResponse.json({ error: "already_subscribed" }, { status: 409 })
  }

  await createContact(name, email)
  return NextResponse.json({ success: true }, { status: 201 })
}
