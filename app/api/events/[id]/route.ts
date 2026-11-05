import { NextRequest, NextResponse } from "next/server"
import { getOptionalUser, requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getEvent, deleteEvent, updateEvent } from "@/lib/aws/dynamo"
import { logAudit } from "@/lib/aws/audit"

interface Props {
  params: Promise<{ id: string }>
}


export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const event = await getEvent(id)
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (event.isPrivate) {
      const payload = await getOptionalUser(request)
      if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 })
      const groups: string[] = payload["cognito:groups"] ?? []
      const isPrivileged = groups.includes("COACH") || groups.includes("ADMIN")
      const callerEmail: string | undefined = payload.email
      if (!isPrivileged && !event.allowedUsers?.includes(callerEmail ?? "")) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
    }

    return NextResponse.json(event)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { id } = await params
  const body = await request.json()
  const patch: { isPrivate?: boolean; allowedUsers?: string[] } = {}
  if (typeof body.isPrivate === "boolean") patch.isPrivate = body.isPrivate
  if (Array.isArray(body.allowedUsers)) patch.allowedUsers = body.allowedUsers

  try {
    const existing = await getEvent(id)
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    await updateEvent(id, patch)
    void logAudit({
      actorUsername: payload["cognito:username"] ?? payload.sub ?? "",
      action: "UPDATE",
      entityType: "EVENT",
      entityId: id,
      entityLabel: existing.title,
      previousState: existing as Record<string, unknown>,
      newState: { ...existing, ...patch } as Record<string, unknown>,
      reversible: true,
    })
    return NextResponse.json({ ...existing, ...patch })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

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
