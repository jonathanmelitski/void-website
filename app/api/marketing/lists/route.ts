import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { listContactLists, createContactList } from "@/lib/aws/ses"


export async function GET(request: NextRequest) {
  const caller = await requireUser(request, { permission: "marketing.send" })
  if (!caller.ok) return caller.response

  const lists = await listContactLists()
  return NextResponse.json(lists)
}

export async function POST(request: NextRequest) {
  const caller = await requireUser(request, { permission: "marketing.send" })
  if (!caller.ok) return caller.response

  const { name, description } = await request.json()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  await createContactList(name, description)
  return NextResponse.json({ success: true }, { status: 201 })
}
