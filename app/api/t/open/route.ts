import { NextRequest, NextResponse } from "next/server"
import { logTrackingEvent } from "@/lib/aws/tracking"

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const messageId = searchParams.get("m") ?? ""
  const sendId = searchParams.get("s") ?? ""

  if (messageId && sendId) {
    await logTrackingEvent({
      type: "open",
      messageId,
      sendId,
      timestamp: new Date().toISOString(),
    }).catch(() => {})
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Length": String(PIXEL.length),
    },
  })
}
