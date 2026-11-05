import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { listEvents, createEvent } from "@/lib/aws/dynamo"
import { logAudit } from "@/lib/aws/audit"
import { canViewEvent, getCaller } from "@/lib/event-access"
import { publicReadHeaders } from "@/lib/http-cache"
import { randomUUID } from "crypto"

export async function GET(request: NextRequest) {
  try {
    const [events, caller] = await Promise.all([listEvents(), getCaller(request)])
    // The list depends on who asks (private events): anonymous only gets a short browser cache
    return NextResponse.json(events.filter((e) => canViewEvent(e, caller)), {
      headers: publicReadHeaders(request, { maxAge: 30, swr: 300, isPrivateData: !!caller }),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch events"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload } = auth

  const { title, date, location, description, coverPhotoKey, isPrivate, allowedUsers } = await request.json()
  if (!title || !date) {
    return NextResponse.json({ error: "Title and date are required" }, { status: 400 })
  }

  const item = {
    id: randomUUID(),
    title,
    date,
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(coverPhotoKey ? { coverPhotoKey } : {}),
    ...(isPrivate ? { isPrivate: true } : {}),
    ...(isPrivate && Array.isArray(allowedUsers) && allowedUsers.length > 0 ? { allowedUsers } : {}),
    createdAt: new Date().toISOString(),
  }

  try {
    await createEvent(item)
    void logAudit({
      actorUsername: payload["cognito:username"] ?? payload.sub ?? "",
      action: "CREATE",
      entityType: "EVENT",
      entityId: item.id,
      entityLabel: item.title,
      newState: item as Record<string, unknown>,
      reversible: true,
    })
    revalidatePath("/") // ISR home page lists events
    return NextResponse.json(item, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
