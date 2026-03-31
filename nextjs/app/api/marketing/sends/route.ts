import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listSends } from "@/lib/aws/sends"

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

  const sends = await listSends()
  return NextResponse.json(sends)
}
