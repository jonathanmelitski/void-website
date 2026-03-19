import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getNewsletter } from "@/lib/aws/newsletters"
import { sendNewsletterToList, sendTestEmail } from "@/lib/aws/ses"
import { logSend } from "@/lib/aws/sends"
import { logAudit } from "@/lib/aws/audit"

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

export async function POST(request: NextRequest) {
  const caller = await requireAdmin(request)
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const { mode, newsletterId, subject, replyTo, fromName, includeWebLink, trackingEnabled } = body

  if (!newsletterId) return NextResponse.json({ error: "newsletterId is required" }, { status: 400 })

  const newsletter = await getNewsletter(newsletterId)
  if (!newsletter) return NextResponse.json({ error: "Newsletter not found" }, { status: 404 })

  const opts = {
    subject: typeof subject === "string" ? subject : undefined,
    replyTo: typeof replyTo === "string" ? replyTo : undefined,
    fromName: typeof fromName === "string" ? fromName : undefined,
    includeWebLink: includeWebLink === true,
    trackingEnabled: trackingEnabled === true,
  }

  if (mode === "list") {
    const { listName } = body
    if (!listName) return NextResponse.json({ error: "listName is required" }, { status: 400 })

    const sendId = randomUUID()
    const result = await sendNewsletterToList(newsletterId, newsletter, listName, opts, sendId)

    const listRecord = await logSend({
      newsletterId,
      newsletterTitle: newsletter.title,
      listName,
      sendMode: "list",
      sentAt: new Date().toISOString(),
      sentBy: caller.username,
      recipientCount: result.sent,
      trackingEnabled: opts.trackingEnabled,
      trackedLinks: opts.trackingEnabled ? result.trackedLinks : undefined,
    }, sendId)

    void logAudit({
      actorUsername: caller.username,
      action: "SEND",
      entityType: "SEND",
      entityId: listRecord.id,
      entityLabel: newsletter.title,
      newState: {
        newsletterTitle: newsletter.title,
        newsletterId,
        listName,
        recipientCount: result.sent,
        subject: opts.subject ?? newsletter.title,
        replyTo: opts.replyTo,
        fromName: opts.fromName,
        trackingEnabled: opts.trackingEnabled,
        sendMode: "list",
        trackedLinks: result.trackedLinks,
      },
      reversible: false,
    })

    return NextResponse.json({ success: true, sent: result.sent })
  }

  if (mode === "test") {
    const { email } = body
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })

    const sendId = randomUUID()
    const testResult = await sendTestEmail(newsletter, email, opts, opts.trackingEnabled ? sendId : undefined)

    const record = await logSend({
      newsletterId,
      newsletterTitle: newsletter.title,
      listName: `test → ${email}`,
      sendMode: "test",
      sentAt: new Date().toISOString(),
      sentBy: caller.username,
      recipientCount: 1,
      trackingEnabled: opts.trackingEnabled,
      trackedLinks: opts.trackingEnabled ? testResult.trackedLinks : undefined,
    }, sendId)

    void logAudit({
      actorUsername: caller.username,
      action: "SEND",
      entityType: "SEND",
      entityId: record.id,
      entityLabel: `[TEST] ${newsletter.title}`,
      newState: {
        newsletterTitle: newsletter.title,
        newsletterId,
        toEmail: email,
        subject: opts.subject ? `[TEST] ${opts.subject}` : `[TEST] ${newsletter.title}`,
        replyTo: opts.replyTo,
        fromName: opts.fromName,
        trackingEnabled: opts.trackingEnabled,
        sendMode: "test",
      },
      reversible: false,
    })

    return NextResponse.json({ success: true, sendId: record.id })
  }

  return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
}
