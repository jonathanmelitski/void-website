import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { createContacts } from "@/lib/aws/ses"

type Params = { params: Promise<{ name: string }> }


export async function POST(request: NextRequest, { params }: Params) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const { name } = await params
  const { emails } = await request.json()
  if (!Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ error: "emails array is required" }, { status: 400 })
  }

  const result = await createContacts(name, emails)
  return NextResponse.json(result, { status: 200 })
}
