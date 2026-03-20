import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getSend, logSend } from "@/lib/aws/sends"
import { getNewsletter } from "@/lib/aws/newsletters"
import { sendToEmails } from "@/lib/aws/ses"
import { logAudit } from "@/lib/aws/audit"

export const maxDuration = 60

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await requireAdmin(request)
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const send = await getSend(id)
  if (!send) return NextResponse.json({ error: "Send not found" }, { status: 404 })

  const failed = send.failedRecipients
  if (!failed || failed.length === 0) {
    return NextResponse.json({ error: "No failed recipients to resend to" }, { status: 400 })
  }

  const newsletter = await getNewsletter(send.newsletterId)
  if (!newsletter) return NextResponse.json({ error: "Newsletter not found" }, { status: 404 })

  const sendId = randomUUID()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const opts = {
          trackingEnabled: send.trackingEnabled,
          includeWebLink: false,
        }

        const result = await sendToEmails(
          failed, newsletter, send.listName, opts, sendId,
          {
            onStart: (total) => emit({ type: "start", total }),
            onResult: (email, status) => emit({ type: "result", email, status }),
          }
        )

        const resendRecord = await logSend({
          newsletterId: send.newsletterId,
          newsletterTitle: send.newsletterTitle,
          listName: send.listName,
          sendMode: "list",
          sentAt: new Date().toISOString(),
          sentBy: caller.username,
          recipientCount: result.sent,
          failedCount: result.failed,
          failedRecipients: result.failedRecipients.length > 0 ? result.failedRecipients : undefined,
          trackingEnabled: send.trackingEnabled,
          trackedLinks: send.trackingEnabled ? result.trackedLinks : undefined,
        }, sendId)

        void logAudit({
          actorUsername: caller.username,
          action: "SEND",
          entityType: "SEND",
          entityId: resendRecord.id,
          entityLabel: `[RESEND] ${newsletter.title}`,
          newState: {
            originalSendId: id,
            newsletterTitle: newsletter.title,
            listName: send.listName,
            recipientCount: result.sent,
            failedCount: result.failed,
            sendMode: "resend",
            trackingEnabled: send.trackingEnabled,
          },
          reversible: false,
        })

        emit({ type: "done", sendId, sent: result.sent, failed: result.failed })
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Resend failed" })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  })
}
