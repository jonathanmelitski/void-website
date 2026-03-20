import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getSuppressedEmails, getSesAccountInfo, getSesCloudWatchMetrics } from "@/lib/aws/ses-audit"

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  try {
    const payload = await verifyToken(token)
    const groups: string[] = payload["cognito:groups"] ?? []
    if (!groups.includes("ADMIN")) return null
    return true
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const [account, metrics, suppressed] = await Promise.all([
    getSesAccountInfo().catch(err => ({ error: String(err) })),
    getSesCloudWatchMetrics(30).catch(err => { console.error("[ses-audit] cloudwatch error:", err); return [] }),
    getSuppressedEmails().catch(err => { console.error("[ses-audit] suppression error:", err); return [] }),
  ])

  return NextResponse.json({ account, metrics, suppressed })
}
