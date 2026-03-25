import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getEvent, deleteEvent } from "@/lib/aws/dynamo"
import { logAudit } from "@/lib/aws/audit"

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const event = await getEvent(id)
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(event)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const groups = payload["cognito:groups"] ?? []
  if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  try {
    const existing = await getEvent(id)
    await deleteEvent(id)
    void logAudit({
      actorUsername: payload["cognito:username"] ?? payload.sub ?? "",
      action: "DELETE",
      entityType: "EVENT",
      entityId: id,
      entityLabel: existing?.title ?? id,
      previousState: existing as Record<string, unknown> ?? undefined,
      reversible: !!existing,
    })
    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
