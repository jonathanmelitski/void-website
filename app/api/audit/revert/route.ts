import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { getAuditLog, checkRevertConflicts, revertAuditLog } from "@/lib/aws/audit"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const actorUsername = (payload["cognito:username"] ?? payload.sub ?? "") as string

  const { id, force = false } = await request.json()
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const entry = await getAuditLog(id)
  if (!entry) return NextResponse.json({ error: "Audit log entry not found" }, { status: 404 })

  if (!entry.reversible) {
    return NextResponse.json({ error: "This entry is not reversible" }, { status: 400 })
  }

  if (entry.revertedBy) {
    return NextResponse.json({ error: "Already reverted" }, { status: 409 })
  }

  const { warnings, blocking } = await checkRevertConflicts(entry)

  if (blocking && !force) {
    return NextResponse.json({ error: "Conflict detected", warnings, blocking }, { status: 409 })
  }

  await revertAuditLog(entry, actorUsername)

  return NextResponse.json({ success: true, warnings })
}
