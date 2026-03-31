import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getNewsletter, removeNewsletterEntry } from "@/lib/aws/newsletters"

type Params = { params: Promise<{ id: string; entryId: string }> }

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, entryId } = await params
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
