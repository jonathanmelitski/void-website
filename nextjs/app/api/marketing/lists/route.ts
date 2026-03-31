import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listContactLists, createContactList } from "@/lib/aws/ses"

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

export async function GET(request: NextRequest) {
  const caller = await requireAdmin(request)
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const lists = await listContactLists()
  return NextResponse.json(lists)
}

export async function POST(request: NextRequest) {
  const caller = await requireAdmin(request)
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { name, description } = await request.json()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  await createContactList(name, description)
  return NextResponse.json({ success: true }, { status: 201 })
}
