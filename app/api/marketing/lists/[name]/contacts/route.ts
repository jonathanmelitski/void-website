import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { listContacts, createContact, deleteContact } from "@/lib/aws/ses"

type Params = { params: Promise<{ name: string }> }


export async function GET(request: NextRequest, { params }: Params) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const { name } = await params
  const contacts = await listContacts(name)
  return NextResponse.json(contacts)
}

export async function POST(request: NextRequest, { params }: Params) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const { name } = await params
  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })

  await createContact(name, email)
  return NextResponse.json({ success: true }, { status: 201 })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const { name } = await params
  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })

  await deleteContact(name, email)
  return new NextResponse(null, { status: 204 })
}
