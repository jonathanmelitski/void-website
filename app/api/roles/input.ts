import { isPermission, ROLE_COLORS, type Permission } from "@/lib/permissions/catalog"

type RoleInput = { name?: string; color?: string | null; permissions?: Permission[] }

/** Validates a role create/update body. Unknown permission keys are rejected, not ignored. */
export function parseRoleInput(
  body: unknown,
  { requireName }: { requireName: boolean }
): { ok: true; value: RoleInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." }
  const b = body as Record<string, unknown>
  const value: RoleInput = {}

  if (b.name !== undefined || requireName) {
    const name = typeof b.name === "string" ? b.name.trim() : ""
    if (!name) return { ok: false, error: "Give the role a name." }
    if (name.length > 40) return { ok: false, error: "Role names can be at most 40 characters." }
    if (name.toLowerCase() === "owner") return { ok: false, error: "“Owner” is reserved." }
    value.name = name
  }
  if (b.color !== undefined) {
    if (b.color !== null && !(ROLE_COLORS as readonly unknown[]).includes(b.color)) return { ok: false, error: "Unknown colour." }
    value.color = b.color as string | null
  }
  if (b.permissions !== undefined) {
    if (!Array.isArray(b.permissions) || !b.permissions.every(isPermission)) {
      return { ok: false, error: "Unknown permission in the list." }
    }
    value.permissions = [...new Set(b.permissions as Permission[])]
  }
  return { ok: true, value }
}
