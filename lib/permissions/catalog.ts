// The single list of site permissions. Pure data, safe on client and server.
// Adding a feature that needs gating = add one entry here, then gate with
// `requireUser(request, { permission })` on the server and `useCan()` in the UI.
// The role editor renders straight from this list, grouped by `area`.

export const PERMISSION_AREAS = ["General", "Live", "Film", "Content", "Admin", "Infrastructure"] as const
export type PermissionArea = (typeof PERMISSION_AREAS)[number]

export const PERMISSIONS = [
  { key: "administrator", area: "General", label: "Administrator", description: "Every permission, including ones added later. Use sparingly." },
  { key: "events.manage", area: "Live", label: "Manage events", description: "Create, edit and delete events and their cover photos." },
  { key: "events.viewPrivate", area: "Live", label: "See private events", description: "See every private event and test game, not just ones they're invited to." },
  { key: "games.score", area: "Live", label: "Score games", description: "Create and edit games, lines, points and point events." },
  { key: "players.manage", area: "Live", label: "Manage players", description: "Add, edit and remove roster players." },
  { key: "film.manage", area: "Film", label: "Manage film", description: "Add, import, reorder and annotate film clips, and edit anyone's annotations." },
  { key: "playerLinks.manage", area: "Film", label: "Link players to accounts", description: "Connect site accounts to roster players so they see their footage." },
  { key: "photos.upload", area: "Content", label: "Upload photos", description: "Upload photos to event galleries." },
  { key: "newsletters.edit", area: "Content", label: "Edit newsletters", description: "Create, edit, publish and export newsletters." },
  { key: "newsletters.delete", area: "Content", label: "Delete newsletters", description: "Delete newsletters and any newsletter entry." },
  { key: "marketing.send", area: "Content", label: "Send marketing email", description: "Manage mailing lists, send campaigns and view delivery reports." },
  { key: "users.manage", area: "Admin", label: "Manage users", description: "Invite and remove users, and assign roles they're allowed to assign." },
  { key: "roles.manage", area: "Admin", label: "Manage roles", description: "Create and edit roles, limited to permissions they hold." },
  { key: "audit.view", area: "Admin", label: "View audit log", description: "See who changed what." },
  { key: "audit.revert", area: "Admin", label: "Revert audit entries", description: "Undo changes from the audit log." },
  { key: "broadcast.manage", area: "Infrastructure", label: "Run broadcast", description: "Start and stop the live stream." },
  { key: "liveServer.manage", area: "Infrastructure", label: "Run live server", description: "Start and stop the live scoring server." },
] as const satisfies readonly { key: string; area: PermissionArea; label: string; description: string }[]

export type Permission = (typeof PERMISSIONS)[number]["key"]
export type PermissionDef = (typeof PERMISSIONS)[number]

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS.map((p) => p.key)
const KNOWN = new Set<string>(ALL_PERMISSIONS)

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && KNOWN.has(value)
}

/** Keeps known permission keys, drops anything else (old or tampered rows). */
export function sanitizePermissions(values: unknown): Permission[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter(isPermission))]
}

type PermissionSet = ReadonlySet<Permission> | readonly Permission[]
const has = (perms: PermissionSet, p: Permission) =>
  perms instanceof Set ? perms.has(p) : (perms as readonly Permission[]).includes(p)

/** True if `perms` grants `p`. `administrator` grants everything. */
export function can(perms: PermissionSet | null | undefined, p: Permission): boolean {
  if (!perms) return false
  return has(perms, "administrator") || has(perms, p)
}

/** True if `perms` grants at least one of `ps`. */
export function canAny(perms: PermissionSet | null | undefined, ps: readonly Permission[]): boolean {
  return ps.some((p) => can(perms, p))
}

/** Union of several roles' permissions. */
export function unionPermissions(lists: readonly (readonly Permission[])[]): Set<Permission> {
  const out = new Set<Permission>()
  for (const list of lists) for (const p of list) out.add(p)
  return out
}

/** Every permission `perms` effectively holds (expands administrator). */
export function expandPermissions(perms: PermissionSet): Permission[] {
  return can(perms, "administrator") ? [...ALL_PERMISSIONS] : ALL_PERMISSIONS.filter((p) => has(perms, p))
}

/** Role colour swatches (keys stored on the role; the UI maps them to categorical hues). */
export const ROLE_COLORS = ["slate", "blue", "violet", "green", "amber", "red", "pink", "teal"] as const
export type RoleColor = (typeof ROLE_COLORS)[number]

/** Role summary as the client sees it. */
export type RoleSummary = { id: string; name: string; color?: string }
