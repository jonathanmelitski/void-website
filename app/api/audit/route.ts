import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { listAuditLogs } from "@/lib/aws/audit"

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get("limit") ?? "100", 10)

  const logs = await listAuditLogs(limit)
  return NextResponse.json(logs)
}
