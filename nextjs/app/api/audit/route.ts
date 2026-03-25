import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listAuditLogs } from "@/lib/aws/audit"

export async function GET(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const groups = (payload["cognito:groups"] ?? []) as string[]
  if (!groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get("limit") ?? "100", 10)

  const logs = await listAuditLogs(limit)
  return NextResponse.json(logs)
}
