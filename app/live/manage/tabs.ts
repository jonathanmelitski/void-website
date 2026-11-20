import { can, type Permission } from "@/lib/permissions/catalog"

/** Manage tabs and the permission each needs. The panel's API routes enforce the same permission. */
export const MANAGE_TABS = [
  { id: "photos", label: "Photos", permission: "photos.upload" },
  { id: "events", label: "Events", permission: "events.manage" },
  { id: "games", label: "Games", permission: "games.score" },
  { id: "players", label: "Players", permission: "players.manage" },
  { id: "film", label: "Film", permission: "film.manage" },
  { id: "player-links", label: "Player links", permission: "playerLinks.manage" },
  { id: "newsletters", label: "Newsletters", permission: "newsletters.edit" },
  { id: "users", label: "Users", permission: "users.manage" },
  { id: "roles", label: "Roles", permission: "roles.manage" },
  { id: "audit", label: "Audit", permission: "audit.view" },
  { id: "marketing", label: "Marketing", permission: "marketing.send" },
  { id: "live-server", label: "Live server", permission: "liveServer.manage" },
] as const satisfies readonly { id: string; label: string; permission: Permission }[]

export type ManageTab = (typeof MANAGE_TABS)[number]["id"]

export function visibleManageTabs(permissions: readonly Permission[] | undefined) {
  return MANAGE_TABS.filter((t) => can(permissions, t.permission))
}
