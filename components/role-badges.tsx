import { Crown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { RoleColor, RoleSummary } from "@/lib/permissions/catalog"

/** Categorical role hues (CLAUDE.md allows fixed hues for categorical data). */
export const ROLE_COLOR_VALUE: Record<RoleColor, string> = {
  slate: "oklch(0.65 0.02 260)",
  blue: "oklch(0.62 0.17 255)",
  violet: "oklch(0.6 0.2 290)",
  green: "oklch(0.66 0.16 150)",
  amber: "oklch(0.75 0.15 75)",
  red: "oklch(0.62 0.2 25)",
  pink: "oklch(0.68 0.18 350)",
  teal: "oklch(0.68 0.12 190)",
}

export function RoleDot({ color, className }: { color?: string; className?: string }) {
  const value = ROLE_COLOR_VALUE[color as RoleColor] ?? ROLE_COLOR_VALUE.slate
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: value }} />
}

export function RoleBadge({ role }: { role: RoleSummary }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <RoleDot color={role.color} />
      {role.name}
    </Badge>
  )
}

export function OwnerBadge() {
  return (
    <Badge variant="brand">
      <Crown aria-hidden />
      Owner
    </Badge>
  )
}

/** A user's roles as pills; Owner first. Shows `empty` when they hold none. */
export function RoleBadges({
  roles,
  isOwner,
  empty = "Member",
  className,
}: {
  roles: RoleSummary[]
  isOwner?: boolean
  empty?: string
  className?: string
}) {
  if (!isOwner && roles.length === 0) {
    return <Badge variant="outline" className={className}>{empty}</Badge>
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {isOwner && <OwnerBadge />}
      {roles.map((r) => <RoleBadge key={r.id} role={r} />)}
    </span>
  )
}
