import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { createRole, listRoles } from "@/lib/aws/roles"
import { listUserRoles } from "@/lib/aws/user-roles"
import { logAudit } from "@/lib/aws/audit"
import { sanitizePermissions } from "@/lib/permissions/catalog"
import { canEditRole } from "@/lib/permissions/guard"
import { actorFrom } from "@/lib/permissions/admin"
import { invalidatePermissionCache } from "@/lib/permissions/server"
import { parseRoleInput } from "./input"

/** Roles with member counts. Readable by anyone who manages roles or users (to assign them). */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { permission: ["roles.manage", "users.manage"] })
  if (!auth.ok) return auth.response

  const [roles, assignments] = await Promise.all([listRoles(), listUserRoles()])
  const counts = new Map<string, number>()
  for (const a of assignments) for (const id of a.roleIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1)
  return NextResponse.json(roles.map((r) => ({ ...r, memberCount: counts.get(r.id) ?? 0 })))
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { permission: "roles.manage" })
  if (!auth.ok) return auth.response

  const input = parseRoleInput(await request.json().catch(() => null), { requireName: true })
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })

  const permissions = sanitizePermissions(input.value.permissions ?? [])
  const check = canEditRole(actorFrom(auth), null, permissions)
  if (!check.ok) return NextResponse.json({ error: check.reason, code: "FORBIDDEN" }, { status: 403 })

  const existing = await listRoles()
  if (existing.some((r) => r.name.toLowerCase() === input.value.name!.toLowerCase())) {
    return NextResponse.json({ error: "A role with that name already exists." }, { status: 409 })
  }
  const position = existing.reduce((max, r) => Math.max(max, r.position), 0) + 1
  const role = await createRole({ name: input.value.name!, color: input.value.color ?? undefined, permissions, position }, auth.username)
  invalidatePermissionCache()
  void logAudit({
    actorUsername: auth.username,
    action: "CREATE",
    entityType: "ROLE",
    entityId: role.id,
    entityLabel: role.name,
    newState: { name: role.name, permissions: role.permissions },
    reversible: false,
  })
  return NextResponse.json({ ...role, memberCount: 0 }, { status: 201 })
}
