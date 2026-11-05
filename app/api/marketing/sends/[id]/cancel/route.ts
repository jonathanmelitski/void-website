import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { getSend, requestCancel } from "@/lib/aws/sends"
import { logAudit } from "@/lib/aws/audit"
import { sendState } from "@/lib/bulk-send"

// Stops a running or queued send before its next batch. Cancelling never sends email, so no TOTP.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const { id } = await params
  const send = await getSend(id)
  if (!send) return NextResponse.json({ error: "Send not found" }, { status: 404 })

  const state = sendState(send)
  if (state === "complete" || state === "cancelled" || state === "legacy") {
    return NextResponse.json({ error: "This send isn't running." }, { status: 409 })
  }

  try {
    // A queued job or a stopped run has nobody to notice the flag, so mark it cancelled now.
    await requestCancel(id, state !== "sending")
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return NextResponse.json({ error: "This send already finished." }, { status: 409 })
    }
    throw err
  }

  await logAudit({
    actorUsername: caller.username,
    action: "SEND",
    entityType: "SEND",
    entityId: id,
    entityLabel: `[CANCEL] ${send.newsletterTitle}`,
    newState: { listName: send.listName, recipientCount: send.recipientCount, sendMode: "cancel" },
    reversible: false,
  }).catch(err => console.error("[cancel] audit write failed:", err instanceof Error ? err.name : err))

  return NextResponse.json({ success: true })
}
