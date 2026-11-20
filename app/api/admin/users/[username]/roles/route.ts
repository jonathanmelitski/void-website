import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { getUserRoles, setUserRoles } from "@/lib/aws/user-roles"
import { logAudit } from "@/lib/aws/audit"
import { canAssignRoles } from "@/lib/permissions/guard"
import { actorFrom, getTargetUser, roleNames, rolePermissionMap } from "@/lib/permissions/admin"
import { invalidatePermissionCache } from "@/lib/permissions/server"

type Params = { params: Promise<{ username: string }> }

/** Replace the roles a user holds. Body: { roleIds: string[] } */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { permission: "users.manage" })
  if (!auth.ok) return auth.response

  const { username } = await params
  const body = await request.json().catch(() => null)
  const roleIds: unknown = body?.roleIds
  if (!Array.isArray(roleIds) || !roleIds.every((r) => typeof r === "string")) {
    return NextResponse.json({ error: "roleIds must be a list of role IDs" }, { status: 400 })
  }

  const target = await getTargetUser(decodeURIComponent(username))
  if (!target?.sub) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const [before, roles] = await Promise.all([getUserRoles(target.sub), rolePermissionMap()])
  const after = [...new Set(roleIds as string[])]
  const check = canAssignRoles(actorFrom(auth), target.sub, before, after, roles)
  if (!check.ok) return NextResponse.json({ error: check.reason, code: "FORBIDDEN" }, { status: 403 })

  // Drop IDs of roles that were deleted meanwhile.
  const kept = after.filter((id) => roles.has(id))
  await setUserRoles(target.sub, kept, auth.username)
  invalidatePermissionCache(target.sub)
  const [beforeNames, afterNames] = await Promise.all([roleNames(before), roleNames(kept)]).catch(() => [before, kept])
  void logAudit({
    actorUsername: auth.username,
    action: "UPDATE",
    entityType: "USER_ROLES",
    entityId: target.sub,
    entityLabel: target.email || target.username,
    previousState: { roles: beforeNames },
    newState: { roles: afterNames },
    reversible: false,
  })
  return NextResponse.json({ roleIds: kept })
}
