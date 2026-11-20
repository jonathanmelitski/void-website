"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
import { useAuth } from "@/lib/use-auth"
import type { Permission } from "@/lib/permissions/catalog"
import { canGrant } from "@/lib/permissions/guard"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RoleBadges, RoleDot } from "@/components/role-badges"
import { CONNECTION_HINT } from "./api-helpers"

export type RoleRow = {
  id: string
  name: string
  color?: string
  permissions: Permission[]
  position: number
  memberCount: number
}

/** Roles from /api/roles (needs roles.manage or users.manage). */
export function useRoles() {
  const [roles, setRoles] = useState<RoleRow[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    apiFetch("/api/roles")
      .then(async res => {
        if (cancelled) return
        if (!res.ok) { setError("Couldn't load roles. Reload to try again."); return }
        setRoles(await res.json())
      })
      .catch(() => { if (!cancelled) setError(`Couldn't load roles. ${CONNECTION_HINT}`) })
    return () => { cancelled = true }
  }, [])
  return { roles, setRoles, error }
}

/**
 * Mirrors the server's anti-escalation rule (same function) so the UI disables what the API
 * would refuse. The server still decides.
 */
export function useCanGrant() {
  const { user } = useAuth()
  return useCallback(
    (permissions: readonly Permission[]) =>
      !!user && canGrant({ sub: "", isOwner: user.isOwner, permissions: new Set(user.permissions) }, permissions).ok,
    [user]
  )
}

/** Checkbox list of roles in a popover. Calls onChange with the full new selection. */
export function RolePicker({
  roles,
  value,
  onChange,
  disabled,
  label,
  isOwner,
  empty = "No roles",
  triggerClassName,
}: {
  roles: RoleRow[]
  value: string[]
  onChange: (roleIds: string[]) => void
  disabled?: boolean
  /** Accessible name, e.g. "Roles for sam@example.com". */
  label: string
  isOwner?: boolean
  empty?: string
  triggerClassName?: string
}) {
  const grantable = useCanGrant()
  const selected = new Set(value)
  const held = roles.filter(r => selected.has(r.id))

  function toggle(id: string, on: boolean) {
    const next = new Set(value)
    if (on) next.add(id)
    else next.delete(id)
    onChange(roles.filter(r => next.has(r.id)).map(r => r.id))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={label}
          className={triggerClassName ?? "h-auto min-h-8 max-w-full justify-between gap-2 py-1 text-left"}
        >
          <RoleBadges roles={held} isOwner={isOwner} empty={empty} className="min-w-0" />
          <ChevronDown aria-hidden className="shrink-0 text-fg-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        {roles.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-fg-muted">No roles yet. Create one in the Roles tab.</p>
        ) : (
          <ul className="flex flex-col">
            {roles.map(r => {
              const allowed = grantable(r.permissions)
              return (
                <li key={r.id}>
                  <label
                    className={`flex min-h-10 items-center gap-2.5 rounded-md px-2 text-sm sm:min-h-8 ${allowed ? "cursor-pointer hover:bg-surface-2" : "cursor-not-allowed text-fg-faint"}`}
                    title={allowed ? undefined : "This role has permissions you don't have"}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      checked={selected.has(r.id)}
                      disabled={!allowed}
                      onChange={e => toggle(r.id, e.target.checked)}
                    />
                    <RoleDot color={r.color} />
                    <span className="min-w-0 truncate">{r.name}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Button + popover listing roles; picking one calls onPick. Used for bulk add/remove on selected users. */
export function RoleMenuButton({
  roles,
  label,
  onPick,
  disabled,
}: {
  roles: RoleRow[]
  label: string
  onPick: (role: RoleRow) => void
  disabled?: boolean
}) {
  const grantable = useCanGrant()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled} className="h-10 sm:h-8">
          {label}
          <ChevronDown aria-hidden className="text-fg-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        {roles.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-fg-muted">No roles yet. Create one in the Roles tab.</p>
        ) : (
          <ul className="flex flex-col">
            {roles.map(r => {
              const allowed = grantable(r.permissions)
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={!allowed}
                    title={allowed ? undefined : "This role has permissions you don't have"}
                    onClick={() => { setOpen(false); onPick(r) }}
                    className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-fg-faint disabled:hover:bg-transparent sm:min-h-8"
                  >
                    <RoleDot color={r.color} />
                    <span className="min-w-0 truncate">{r.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
