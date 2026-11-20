"use client"

import { useAuth } from "@/lib/use-auth"
import { can, canAny, type Permission } from "@/lib/permissions/catalog"

/**
 * True if the signed-in user holds `permission` (or any of a list). UI convenience only:
 * the API enforces the same permission on every request.
 */
export function useCan(permission: Permission | readonly Permission[]): boolean {
  const { user } = useAuth()
  const perms = user?.permissions
  return typeof permission === "string" ? can(perms, permission) : canAny(perms, permission)
}
