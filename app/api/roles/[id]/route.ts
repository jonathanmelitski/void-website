import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { deleteRole, getRole, listRoles, updateRole } from "@/lib/aws/roles"
import { removeRoleFromAll } from "@/lib/aws/user-roles"
import { logAudit } from "@/lib/aws/audit"
import { canEditRole } from "@/lib/permissions/guard"
import { actorFrom } from "@/lib/permissions/admin"
import { invalidatePermissionCache } from "@/lib/permissions/server"
import { parseRoleInput } from "../input"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { permission: "roles.manage" })
  if (!auth.ok) return auth.response
  const { id } = await params

  const input = parseRoleInput(await request.json().catch(() => null), { requireName: false })
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })

  const role = await getRole(id)
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 })

  const after = input.value.permissions ?? role.permissions
  const check = canEditRole(actorFrom(auth), role.permissions, after)
  if (!check.ok) return NextResponse.json({ error: check.reason, code: "FORBIDDEN" }, { status: 403 })

  if (input.value.name && input.value.name.toLowerCase() !== role.name.toLowerCase()) {
    const clash = (await listRoles()).some((r) => r.id !== id && r.name.toLowerCase() === input.value.name!.toLowerCase())
    if (clash) return NextResponse.json({ error: "A role with that name already exists." }, { status: 409 })
  }

  await updateRole(id, input.value, auth.username)
  invalidatePermissionCache()
  const updated = { ...role, ...input.value, permissions: after }
  void logAudit({
    actorUsername: auth.username,
    action: "UPDATE",
    entityType: "ROLE",
    entityId: id,
    entityLabel: updated.name,
    previousState: { name: role.name, color: role.color ?? null, permissions: role.permissions },
    newState: { name: updated.name, color: updated.color ?? null, permissions: after },
    reversible: false,
  })
  return NextResponse.json(updated)
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { permission: "roles.manage" })
  if (!auth.ok) return auth.response
  const { id } = await params

  const role = await getRole(id)
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 })
  const check = canEditRole(actorFrom(auth), role.permissions, null)
  if (!check.ok) return NextResponse.json({ error: check.reason, code: "FORBIDDEN" }, { status: 403 })

  // Strip assignments first: a crash midway leaves a role with fewer members, never dangling grants.
  const affected = await removeRoleFromAll(id, auth.username)
  await deleteRole(id)
  invalidatePermissionCache()
  void logAudit({
    actorUsername: auth.username,
    action: "DELETE",
    entityType: "ROLE",
    entityId: id,
    entityLabel: role.name,
    previousState: { name: role.name, permissions: role.permissions, memberCount: affected.length },
    reversible: false,
  })
  return NextResponse.json({ ok: true, removedFrom: affected.length })
}
