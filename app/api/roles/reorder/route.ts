import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { listRoles, updateRole } from "@/lib/aws/roles"
import { invalidatePermissionCache } from "@/lib/permissions/server"

/**
 * Set the display order of roles. Body: { ids: string[] } with every role ID exactly once.
 * Order is cosmetic (it grants nothing), so any roles.manage holder may reorder any role.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { permission: "roles.manage" })
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  const ids: unknown = body?.ids
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "ids must be a list of role IDs" }, { status: 400 })
  }

  const roles = await listRoles()
  const known = new Set(roles.map((r) => r.id))
  if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    return NextResponse.json({ error: "The role list changed. Reload and try again." }, { status: 409 })
  }

  const current = new Map(roles.map((r) => [r.id, r.position]))
  const changed = (ids as string[]).map((id, i) => ({ id, position: i + 1 })).filter((r) => current.get(r.id) !== r.position)
  await Promise.all(changed.map((r) => updateRole(r.id, { position: r.position }, auth.username)))
  if (changed.length) invalidatePermissionCache() // role pill order comes from the cached role list
  return NextResponse.json({ ok: true, changed: changed.length })
}
