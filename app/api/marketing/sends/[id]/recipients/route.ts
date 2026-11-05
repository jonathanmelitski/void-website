import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { getSend } from "@/lib/aws/sends"
import { listSendRecipients } from "@/lib/aws/send-recipients"
import type { DeliveryStatus } from "@/lib/bulk-send"

// Per-recipient delivery for one send, from what was actually recorded (never inferred from the
// current list). source: "worker" rows, "record" lists (inline sends), or "none" (old sends: only
// failures were stored).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const { id } = await params
  const send = await getSend(id)
  if (!send) return NextResponse.json({ error: "Send not found" }, { status: 404 })

  const map: Record<string, DeliveryStatus> = {
    SENT: "sent", FAILED: "failed", SENDING: "unknown", PENDING: "pending", DRYRUN: "dryrun",
  }

  if (send.engine === "worker") {
    if (!process.env.DYNAMO_SEND_RECIPIENTS_TABLE) {
      return NextResponse.json({ error: "Per-recipient data isn't configured on this server." }, { status: 503 })
    }
    const rows = await listSendRecipients(id)
    return NextResponse.json({
      source: "worker",
      recipients: rows.map(r => ({ email: r.email, status: map[r.status] ?? "unknown" })),
    })
  }

  const failed = (send.failedRecipients ?? []).map(email => ({ email, status: "failed" as const }))
  if (!Array.isArray(send.sentRecipients)) {
    return NextResponse.json({ source: "none", recipients: failed })
  }
  return NextResponse.json({
    source: "record",
    recipients: [
      ...failed,
      ...[...(send.unknownRecipients ?? []), ...(send.inFlight ?? [])].map(email => ({ email, status: "unknown" as const })),
      ...send.sentRecipients.map(email => ({ email, status: "sent" as const })),
    ],
  })
}
