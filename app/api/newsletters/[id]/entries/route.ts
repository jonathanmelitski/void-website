import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { appendNewsletterEntry, updateNewsletterEntries, getNewsletter } from "@/lib/aws/newsletters"
import { randomUUID } from "crypto"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let username: string
  let groups: string[]
  try {
    const payload = await verifyToken(token)
    groups = payload["cognito:groups"] ?? []
    username = payload["cognito:username"] ?? payload.sub ?? ""
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

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
  const newsletter = await getNewsletter(id)
  return NextResponse.json(newsletter, { status: 201 })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const payload = await verifyToken(token)
    const groups = payload["cognito:groups"] ?? []
    if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const { entries } = await request.json()
  await updateNewsletterEntries(id, entries)
  return NextResponse.json({ success: true })
}
