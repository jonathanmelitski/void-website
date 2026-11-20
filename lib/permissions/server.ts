import { getUserRoles } from "@/lib/aws/user-roles"
import { listRoles, type RoleItem } from "@/lib/aws/roles"
import { ALL_PERMISSIONS, unionPermissions, type Permission, type RoleSummary } from "./catalog"

/**
 * Owner = Cognito group OWNER. Owners hold every permission no matter what the roles tables say, and
 * the app never writes Cognito groups, so ownership can only change through AWS (console/CLI).
 * (The old ADMIN/COACH/USER groups are unused since roles; ADMIN no longer means anything.)
 */
export const OWNER_GROUP = "OWNER"
export const isOwnerGroups = (groups: readonly string[] | undefined) => !!groups?.includes(OWNER_GROUP)

const TTL_MS = 30_000
let rolesCache: { roles: Map<string, RoleItem>; at: number } | null = null
const userCache = new Map<string, { roleIds: string[]; at: number }>()

async function rolesById(): Promise<Map<string, RoleItem>> {
  if (rolesCache && Date.now() - rolesCache.at < TTL_MS) return rolesCache.roles
  const roles = new Map((await listRoles()).map((r) => [r.id, r]))
  rolesCache = { roles, at: Date.now() }
  return roles
}

async function roleIdsFor(sub: string): Promise<string[]> {
  const hit = userCache.get(sub)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.roleIds
  const roleIds = await getUserRoles(sub)
  userCache.set(sub, { roleIds, at: Date.now() })
  return roleIds
}

/** Call after any role or assignment write so this instance sees it immediately (others within TTL). */
export function invalidatePermissionCache(sub?: string) {
  rolesCache = null
  if (sub) userCache.delete(sub)
  else userCache.clear()
}

export type ResolvedPermissions = { permissions: Set<Permission>; isOwner: boolean; roleIds: string[] }

/**
 * A user's effective permissions: the union of their roles' permissions, or everything for owners.
 * Throws if the tables can't be read; callers must fail closed (requireUser answers 503).
 */
export async function resolvePermissions(sub: string, groups: readonly string[] | undefined): Promise<ResolvedPermissions> {
  if (isOwnerGroups(groups)) {
    // Still look up roles for display, but never let a lookup failure lock an owner out.
    const roleIds = await roleIdsFor(sub).catch(() => [])
    return { permissions: new Set(ALL_PERMISSIONS), isOwner: true, roleIds }
  }
  const [roleIds, roles] = await Promise.all([roleIdsFor(sub), rolesById()])
  const held = roleIds.map((id) => roles.get(id)).filter((r): r is RoleItem => !!r)
  return { permissions: unionPermissions(held.map((r) => r.permissions)), isOwner: false, roleIds: held.map((r) => r.id) }
}

/** Names and colours for a list of role IDs, in role display order (cached). Unknown IDs are skipped. */
export async function roleSummaries(roleIds: readonly string[]): Promise<RoleSummary[]> {
  const roles = await rolesById()
  return roleIds
    .flatMap((id) => (roles.has(id) ? [roles.get(id)!] : []))
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ id: r.id, name: r.name, ...(r.color ? { color: r.color } : {}) }))
}
