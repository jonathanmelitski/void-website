import { NextRequest, NextResponse } from "next/server"
import { logTrackingEvent } from "@/lib/aws/tracking"
import { getSend } from "@/lib/aws/sends"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const messageId = searchParams.get("m") ?? ""
  const sendId = searchParams.get("s") ?? ""
  const url = searchParams.get("url") ?? ""

  if (!url.startsWith("http")) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  if (messageId && sendId) {
    const send = await getSend(sendId).catch(() => null)
    const isValid =
      send?.trackingEnabled &&
      Array.isArray(send.trackedLinks) &&
      send.trackedLinks.includes(url)

    if (isValid) {
      await logTrackingEvent({
        type: "click",
        messageId,
        sendId,
        url,
        timestamp: new Date().toISOString(),
      }).catch(() => {})
    }
  }

  return NextResponse.redirect(url, { status: 302 })
}
