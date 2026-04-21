import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getAuditLog, checkRevertConflicts, revertAuditLog } from "@/lib/aws/audit"

export async function POST(request: NextRequest) {
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
