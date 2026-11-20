// Anti-escalation rules for role management. Pure, so they're unit-checked in
// scripts/permissions.unit.check.ts. Every role/assignment write route runs these on the server.
import { can, type Permission } from "./catalog"

export type Actor = { sub: string; isOwner: boolean; permissions: ReadonlySet<Permission> }
export type GuardResult = { ok: true } | { ok: false; reason: string }

const OK: GuardResult = { ok: true }
const deny = (reason: string): GuardResult => ({ ok: false, reason })

/**
 * May `actor` hand out (or take away) this set of permissions?
 * Owners: anything. Everyone else: only permissions they hold, and never `administrator`.
 */
export function canGrant(actor: Actor, permissions: readonly Permission[]): GuardResult {
  if (actor.isOwner) return OK
  if (permissions.includes("administrator")) return deny("Only an owner can grant Administrator.")
  const missing = permissions.filter((p) => !can(actor.permissions, p))
  return missing.length ? deny("You can only grant permissions you have yourself.") : OK
}

/** Create, edit or delete a role: the role's permissions before and after must all be grantable. */
export function canEditRole(
  actor: Actor,
  before: readonly Permission[] | null,
  after: readonly Permission[] | null
): GuardResult {
  if (!can(actor.permissions, "roles.manage")) return deny("You don't have permission to manage roles.")
  for (const perms of [before, after]) {
    if (!perms) continue
    const r = canGrant(actor, perms)
    if (!r.ok) return r
  }
  return OK
}

/**
 * Change which roles a user holds. Every role added or removed must be one the actor could grant,
 * and nobody but an owner edits their own roles.
 */
export function canAssignRoles(
  actor: Actor,
  targetSub: string,
  before: readonly string[],
  after: readonly string[],
  rolePermissions: ReadonlyMap<string, readonly Permission[]>
): GuardResult {
  if (!can(actor.permissions, "users.manage")) return deny("You don't have permission to manage users.")
  if (!actor.isOwner && targetSub === actor.sub) return deny("You can't change your own roles.")
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const changed = [...after.filter((id) => !beforeSet.has(id)), ...before.filter((id) => !afterSet.has(id))]
  for (const id of changed) {
    const perms = rolePermissions.get(id)
    if (!perms) {
      // Removing a role that no longer exists is harmless; adding one is not possible.
      if (afterSet.has(id)) return deny("That role doesn't exist.")
      continue
    }
    const r = canGrant(actor, perms)
    if (!r.ok) return deny("That role has permissions you don't have, so you can't assign or remove it.")
  }
  return OK
}
