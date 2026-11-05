import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { getSuppressedEmails, getSesAccountInfo, getSesCloudWatchMetrics } from "@/lib/aws/ses-audit"


export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response

  const [account, metrics, suppressed] = await Promise.all([
    getSesAccountInfo().catch(err => ({ error: String(err) })),
    getSesCloudWatchMetrics(30).catch(err => { console.error("[ses-audit] cloudwatch error:", err); return [] }),
    getSuppressedEmails().catch(err => { console.error("[ses-audit] suppression error:", err); return [] }),
  ])

  return NextResponse.json({ account, metrics, suppressed })
}
