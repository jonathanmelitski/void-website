import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { getSend } from "@/lib/aws/sends"
import { getEventsForSend } from "@/lib/aws/tracking"


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireUser(request, { roles: ADMIN_ONLY })
  if (!admin.ok) return admin.response

  const { id } = await params
  const [send, events] = await Promise.all([getSend(id), getEventsForSend(id)])

  if (!send) return NextResponse.json({ error: "Send not found" }, { status: 404 })

  const openEvents = events.filter(e => e.type === "open")
  const clickEvents = events.filter(e => e.type === "click")

  const uniqueOpens = new Set(openEvents.map(e => e.messageId)).size
  const uniqueClicks = new Set(clickEvents.map(e => e.messageId)).size
  const totalClickEvents = clickEvents.length

  const linkMap = new Map<string, { messageIds: Set<string>; total: number }>()
  for (const e of clickEvents) {
    if (!e.url) continue
    if (!linkMap.has(e.url)) linkMap.set(e.url, { messageIds: new Set(), total: 0 })
    const entry = linkMap.get(e.url)!
    entry.messageIds.add(e.messageId)
    entry.total++
  }

  const linkStats = Array.from(linkMap.entries()).map(([url, { messageIds, total }]) => ({
    url,
    uniqueClicks: messageIds.size,
    totalClicks: total,
  }))

  return NextResponse.json({
    sendId: id,
    recipientCount: send.recipientCount,
    trackedLinks: send.trackedLinks ?? [],
    uniqueOpens,
    uniqueClicks,
    totalClickEvents,
    linkStats,
  })
}
