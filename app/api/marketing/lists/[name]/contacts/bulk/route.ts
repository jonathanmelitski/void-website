import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { createContacts } from "@/lib/aws/ses"

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

export async function POST(request: NextRequest, { params }: Params) {
  const caller = await requireAdmin(request)
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { name } = await params
  const { emails } = await request.json()
  if (!Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ error: "emails array is required" }, { status: 400 })
  }

  const result = await createContacts(name, emails)
  return NextResponse.json(result, { status: 200 })
}
