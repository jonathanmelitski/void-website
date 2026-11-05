// Server-side event visibility, matching GET /api/events and /api/events/[id]:
// public events are visible to everyone; private ones to COACH/ADMIN and to emails in allowedUsers.
import type { NextRequest } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import type { EventItem } from "@/lib/aws/dynamo"

export type Caller = { groups: string[]; email?: string } | null

export async function getCaller(request: NextRequest): Promise<Caller> {
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  try {
    const payload = await verifyToken(token)
    return { groups: payload["cognito:groups"] ?? [], email: payload.email as string | undefined }
  } catch {
    return null
  }
}

export const isCoach = (caller: Caller) =>
  !!caller && (caller.groups.includes("COACH") || caller.groups.includes("ADMIN"))

export function canViewEvent(event: Pick<EventItem, "isPrivate" | "allowedUsers">, caller: Caller): boolean {
  if (!event.isPrivate) return true
  if (isCoach(caller)) return true
  return !!caller?.email && (event.allowedUsers?.includes(caller.email) ?? false)
}
