// Permission union + anti-escalation rules. Run: npx tsx scripts/permissions.unit.check.ts
import assert from "node:assert/strict"
import {
  ALL_PERMISSIONS, can, canAny, expandPermissions, sanitizePermissions, unionPermissions, type Permission,
} from "../lib/permissions/catalog"
import { canAssignRoles, canEditRole, canGrant, type Actor } from "../lib/permissions/guard"

function check(name: string, fn: () => void) {
  fn()
  console.log(`✓ ${name}`)
}

const actor = (perms: Permission[], opts: Partial<Actor> = {}): Actor =>
  ({ sub: "me", isOwner: false, permissions: new Set(perms), ...opts })
const owner = actor([], { isOwner: true, permissions: new Set(ALL_PERMISSIONS) })
const roles = new Map<string, Permission[]>([
  ["coach", ["games.score", "events.manage"]],
  ["editor", ["newsletters.edit"]],
  ["admin", ["administrator"]],
  ["empty", []],
])

check("union of roles", () => {
  const u = unionPermissions([roles.get("coach")!, roles.get("editor")!, roles.get("empty")!])
  assert.deepEqual([...u].sort(), ["events.manage", "games.score", "newsletters.edit"])
})

check("administrator implies every permission", () => {
  assert.ok(can(["administrator"], "audit.revert"))
  assert.deepEqual(expandPermissions(["administrator"]), [...ALL_PERMISSIONS])
  assert.ok(!can(["games.score"], "audit.view"))
  assert.ok(!can(undefined, "games.score"))
  assert.ok(canAny(["film.manage"], ["games.score", "film.manage"]))
})

check("unknown keys are dropped", () => {
  assert.deepEqual(sanitizePermissions(["games.score", "root", 42, "games.score"]), ["games.score"])
  assert.deepEqual(sanitizePermissions("administrator"), [])
})

check("can only grant what you hold", () => {
  const a = actor(["roles.manage", "games.score"])
  assert.ok(canGrant(a, ["games.score"]).ok)
  assert.ok(!canGrant(a, ["games.score", "audit.view"]).ok)
  assert.ok(!canGrant(a, ["roles.manage", "users.manage"]).ok)
})

check("only owners grant administrator", () => {
  const admin = actor(["administrator"])
  assert.ok(canGrant(admin, ["audit.revert", "users.manage"]).ok, "administrator holds everything else")
  assert.ok(!canGrant(admin, ["administrator"]).ok)
  assert.ok(canGrant(owner, ["administrator"]).ok)
})

check("role edits need roles.manage and grantable before/after", () => {
  assert.ok(!canEditRole(actor(["games.score"]), null, ["games.score"]).ok, "no roles.manage")
  const rm = actor(["roles.manage", "games.score", "events.manage"])
  assert.ok(canEditRole(rm, null, ["games.score"]).ok)
  assert.ok(!canEditRole(rm, ["audit.view"], []).ok, "can't strip a role above you")
  assert.ok(!canEditRole(rm, ["games.score"], ["games.score", "audit.view"]).ok, "can't escalate a role")
  assert.ok(!canEditRole(rm, ["administrator"], null).ok, "can't delete an admin role")
})

check("assignment rules", () => {
  const um = actor(["users.manage", "games.score", "events.manage"])
  assert.ok(canAssignRoles(um, "them", [], ["coach"], roles).ok)
  assert.ok(!canAssignRoles(um, "them", [], ["editor"], roles).ok, "role with a missing permission")
  assert.ok(!canAssignRoles(um, "them", ["admin"], [], roles).ok, "can't remove a role above you")
  assert.ok(canAssignRoles(um, "them", ["admin", "coach"], ["admin"], roles).ok, "untouched roles don't matter")
  assert.ok(!canAssignRoles(um, "me", [], ["coach"], roles).ok, "no self-assignment")
  assert.ok(canAssignRoles(owner, "me", [], ["admin"], roles).ok, "owners may edit themselves")
  assert.ok(!canAssignRoles(um, "them", [], ["ghost"], roles).ok, "unknown role")
  assert.ok(canAssignRoles(um, "them", ["ghost"], [], roles).ok, "dropping a deleted role is fine")
  assert.ok(!canAssignRoles(actor(["games.score", "events.manage"]), "them", [], ["coach"], roles).ok, "needs users.manage")
})

console.log("permissions: all checks passed")
