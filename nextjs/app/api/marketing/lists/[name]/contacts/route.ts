import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listContacts, createContact, deleteContact } from "@/lib/aws/ses"

type Params = { params: Promise<{ name: string }> }

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  try {
    const payload = await verifyToken(token)
    const groups: string[] = payload["cognito:groups"] ?? []
    if (!groups.includes("ADMIN")) return null
    return { username: (payload["cognito:username"] ?? payload.sub ?? "") as string }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const caller = await requireAdmin(request)
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { name } = await params
  const contacts = await listContacts(name)
  return NextResponse.json(contacts)
}

export async function POST(request: NextRequest, { params }: Params) {
  const caller = await requireAdmin(request)
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { name } = await params
  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })

  await createContact(name, email)
  return NextResponse.json({ success: true }, { status: 201 })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const caller = await requireAdmin(request)
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { name } = await params
  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })

  await deleteContact(name, email)
  return new NextResponse(null, { status: 204 })
}
