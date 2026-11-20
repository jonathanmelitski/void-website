"use client"

import { useCallback, useState } from "react"
import { GripVertical, Plus, ShieldAlert, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { SkeletonRow } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip } from "@/components/ui/tooltip"
import { RoleDot, ROLE_COLOR_VALUE } from "@/components/role-badges"
import { apiFetch } from "@/lib/api-fetch"
import {
  PERMISSION_AREAS, PERMISSIONS, ROLE_COLORS, expandPermissions, type Permission, type RoleColor,
} from "@/lib/permissions/catalog"
import { CONNECTION_HINT, friendlyError } from "./api-helpers"
import { useCanGrant, useRoles, type RoleRow } from "./roles-shared"
import { useDragReorder } from "./use-drag-reorder"

type Draft = { id: string | null; name: string; color: RoleColor; permissions: Set<Permission> }

const newDraft = (): Draft => ({ id: null, name: "", color: "blue", permissions: new Set() })
const draftFrom = (r: RoleRow): Draft => ({
  id: r.id,
  name: r.name,
  color: (ROLE_COLORS as readonly string[]).includes(r.color ?? "") ? (r.color as RoleColor) : "slate",
  permissions: new Set(r.permissions),
})

/** Role list plus a Discord-style editor: name, colour, and permission checkboxes from the catalog. */
export function RolesPanel() {
  const { roles, setRoles, error } = useRoles()
  const grantable = useCanGrant()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [nameError, setNameError] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [view, setView] = useState<"list" | "matrix">("list")
  const [savingCells, setSavingCells] = useState<Set<string>>(() => new Set())

  // Display order: saved optimistically, rolled back if the server refuses.
  const commitOrder = useCallback(async (ids: string[]) => {
    const previous = roles
    if (!previous) return
    const byId = new Map(previous.map(r => [r.id, r]))
    setRoles(ids.map((id, i) => ({ ...byId.get(id)!, position: i + 1 })))
    try {
      const res = await apiFetch("/api/roles/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
        waitForSession: true,
      })
      if (!res.ok) {
        setRoles(previous)
        toast.error(await friendlyError(res, "Couldn't save the new order. Try again."))
      }
    } catch {
      setRoles(previous)
      toast.error(`Couldn't save the new order. ${CONNECTION_HINT}`)
    }
  }, [roles, setRoles])

  const { order, dragId, itemRef, handleProps } = useDragReorder(roles?.map(r => r.id) ?? [], commitOrder)

  // Matrix cell: toggle one permission on one role, optimistically.
  async function toggleCell(role: RoleRow, p: Permission, on: boolean) {
    const key = `${role.id}:${p}`
    const before = role.permissions
    const after = on ? [...new Set([...before, p])] : before.filter(x => x !== p)
    setSavingCells(prev => new Set(prev).add(key))
    setRoles(prev => (prev ?? []).map(r => (r.id === role.id ? { ...r, permissions: after } : r)))
    const revert = () => setRoles(prev => (prev ?? []).map(r => (r.id === role.id ? { ...r, permissions: before } : r)))
    try {
      const res = await apiFetch(`/api/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: after }),
        waitForSession: true,
      })
      if (!res.ok) { revert(); toast.error(await friendlyError(res, `Couldn't update ${role.name}. Try again.`)) }
    } catch {
      revert()
      toast.error(`Couldn't update ${role.name}. ${CONNECTION_HINT}`)
    } finally {
      setSavingCells(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>

  const editing = draft?.id ? roles?.find(r => r.id === draft.id) : undefined
  // A role holding permissions you lack is read-only for you (the API refuses edits too).
  const readOnly = !!editing && !grantable(editing.permissions)

  function open(next: Draft) {
    setNameError("")
    setDraft(next)
  }

  function togglePermission(p: Permission, on: boolean) {
    if (!draft) return
    const permissions = new Set(draft.permissions)
    if (on) permissions.add(p)
    else permissions.delete(p)
    setDraft({ ...draft, permissions })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    if (!draft.name.trim()) { setNameError("Give the role a name."); return }
    setSaving(true)
    setNameError("")
    const body = JSON.stringify({ name: draft.name.trim(), color: draft.color, permissions: [...draft.permissions] })
    try {
      const res = await apiFetch(draft.id ? `/api/roles/${draft.id}` : "/api/roles", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body,
        waitForSession: true,
      })
      if (!res.ok) {
        const message = await friendlyError(res, "Couldn't save the role. Try again.")
        if (res.status === 409 || res.status === 400) setNameError(message)
        else toast.error(message)
        return
      }
      const saved = await res.json()
      setRoles(prev => {
        const list = prev ?? []
        const exists = list.some(r => r.id === saved.id)
        const merged: RoleRow = exists ? { ...list.find(r => r.id === saved.id)!, ...saved } : saved
        return exists ? list.map(r => (r.id === saved.id ? merged : r)) : [...list, merged]
      })
      toast.success(draft.id ? `Saved ${saved.name}` : `Created ${saved.name}`)
      setDraft(null)
    } catch {
      toast.error(`Couldn't save the role. ${CONNECTION_HINT}`)
    } finally {
      setSaving(false)
    }
  }

  async function remove(role: RoleRow) {
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/roles/${role.id}`, { method: "DELETE", waitForSession: true })
      if (!res.ok) { toast.error(await friendlyError(res, "Couldn't delete the role. Try again.")); return }
      setRoles(prev => (prev ?? []).filter(r => r.id !== role.id))
      toast.success(`Deleted ${role.name}`)
      setDeleteTarget(null)
      setDraft(null)
    } catch {
      toast.error(`Couldn't delete the role. ${CONNECTION_HINT}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 text-left">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Roles</h2>
          <p className="text-sm text-fg-muted">
            A user&apos;s access is everything their roles allow combined. Owners always have full access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={v => setView(v as "list" | "matrix")}>
            <TabsList variant="pill" aria-label="Roles view">
              <TabsTrigger value="list">List</TabsTrigger>
              <TabsTrigger value="matrix">Matrix</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={() => open(newDraft())}>
            <Plus aria-hidden />
            New role
          </Button>
        </div>
      </div>

      {!roles ? (
        <div className="flex flex-col gap-2"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
      ) : roles.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No roles yet"
          description="Create a role, tick what it can do, then assign it to people in Users."
          action={<Button variant="outline" size="sm" onClick={() => open(newDraft())}>New role</Button>}
        />
      ) : view === "matrix" ? (
        <RoleMatrix
          roles={order.map(id => roles.find(r => r.id === id)!).filter(Boolean)}
          grantable={grantable}
          savingCells={savingCells}
          onToggle={toggleCell}
          onOpenRole={r => open(draftFrom(r))}
          dragId={dragId}
          itemRef={itemRef}
          handleProps={handleProps}
        />
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {order.map(id => roles.find(r => r.id === id)).filter((r): r is RoleRow => !!r).map(r => {
              const count = expandPermissions(r.permissions).length
              return (
                <li
                  key={r.id}
                  ref={itemRef(r.id)}
                  className={`flex items-center transition-colors ${dragId === r.id ? "relative z-10 bg-surface-3 shadow-lg" : ""}`}
                >
                  <button
                    {...handleProps(r.id, r.name)}
                    className="flex h-14 w-10 shrink-0 cursor-grab items-center justify-center text-fg-muted hover:text-foreground active:cursor-grabbing"
                  >
                    <GripVertical aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => open(draftFrom(r))}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pr-4 text-left hover:bg-surface-2"
                  >
                    <RoleDot color={r.color} className="size-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block text-xs text-fg-muted">
                        {r.permissions.includes("administrator")
                          ? "Administrator: every permission"
                          : count === 0 ? "No permissions" : `${count} permission${count === 1 ? "" : "s"}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted">
                      {r.memberCount} {r.memberCount === 1 ? "member" : "members"}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-fg-muted">Drag roles to arrange them. Order is only for display and doesn&apos;t change access.</p>
        </>
      )}

      <Dialog open={draft !== null} onOpenChange={o => { if (!o && !saving) setDraft(null) }}>
        <DialogContent
          className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden p-0"
          // Editing an existing role: don't focus Name (it pops the phone keyboard over the checkboxes)
          onOpenAutoFocus={e => { if (draft?.id) e.preventDefault() }}
        >
          {draft && (
            <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
              <DialogHeader className="shrink-0 px-6 pt-6">
                <DialogTitle>{draft.id ? `Edit ${editing?.name ?? "role"}` : "New role"}</DialogTitle>
                <DialogDescription>
                  {readOnly
                    ? "This role has permissions you don't have, so you can view it but not change it."
                    : "You can only grant permissions you have yourself."}
                </DialogDescription>
              </DialogHeader>

              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
                <Field label="Name" error={nameError}>
                  <Input
                    value={draft.name}
                    maxLength={40}
                    disabled={readOnly}
                    onChange={e => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Coach"
                  />
                </Field>

                <fieldset disabled={readOnly} className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium text-fg-secondary">Colour</legend>
                  <div className="flex flex-wrap gap-2">
                    {ROLE_COLORS.map(c => (
                      <label key={c} className="relative cursor-pointer">
                        <input
                          type="radio"
                          name="role-color"
                          value={c}
                          checked={draft.color === c}
                          onChange={() => setDraft({ ...draft, color: c })}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden
                          className="block size-8 rounded-full ring-offset-2 ring-offset-card peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-brand"
                          style={{ background: ROLE_COLOR_VALUE[c] }}
                        />
                        <span className="sr-only">{c}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {PERMISSION_AREAS.map(area => {
                  const items = PERMISSIONS.filter(p => p.area === area)
                  if (items.length === 0) return null
                  return (
                    <fieldset key={area} className="flex flex-col">
                      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{area}</legend>
                      <ul className="divide-y divide-border">
                        {items.map(p => {
                          const allowed = !readOnly && grantable([p.key])
                          const checked = draft.permissions.has(p.key)
                          return (
                            <li key={p.key}>
                              <label className={`flex items-start gap-3 py-2.5 ${allowed ? "cursor-pointer" : "cursor-not-allowed"}`}>
                                <input
                                  type="checkbox"
                                  className="mt-0.5 size-4 shrink-0 accent-brand"
                                  checked={checked}
                                  disabled={!allowed}
                                  onChange={e => togglePermission(p.key, e.target.checked)}
                                />
                                <span className="min-w-0">
                                  <span className={`block text-sm font-medium ${allowed ? "" : "text-fg-muted"}`}>{p.label}</span>
                                  <span className="block text-xs text-fg-muted">{p.description}</span>
                                  {p.key === "administrator" && checked && (
                                    <span className="mt-1 flex items-center gap-1 text-xs text-warning">
                                      <ShieldAlert aria-hidden className="size-3.5" />
                                      Grants everything below, plus any permission added later.
                                    </span>
                                  )}
                                </span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </fieldset>
                  )
                })}
              </div>

              <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-2 border-t border-border px-6 pb-6 pt-3 sm:justify-between">
                {editing && !readOnly ? (
                  <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(editing)}>
                    Delete role
                  </Button>
                ) : <span />}
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                    {readOnly ? "Close" : "Cancel"}
                  </Button>
                  {!readOnly && (
                    <Button type="submit" loading={saving}>
                      {draft.id ? "Save changes" : "Create role"}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={o => { if (!o && !deleting) setDeleteTarget(null) }}
        title={`Delete ${deleteTarget?.name ?? "role"}?`}
        description={
          deleteTarget && deleteTarget.memberCount > 0
            ? `${deleteTarget.memberCount} ${deleteTarget.memberCount === 1 ? "person loses" : "people lose"} any access only this role gave them. This can't be undone.`
            : "Nobody has this role. This can't be undone."
        }
        confirmLabel="Delete role"
        destructive
        isLoading={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget)}
      />
    </div>
  )
}

type DragApi = ReturnType<typeof useDragReorder>

/** Roles × permissions grid. Each cell saves on its own; cells you can't grant are disabled. */
function RoleMatrix({
  roles, grantable, savingCells, onToggle, onOpenRole, dragId, itemRef, handleProps,
}: {
  roles: RoleRow[]
  grantable: (p: readonly Permission[]) => boolean
  savingCells: Set<string>
  onToggle: (role: RoleRow, p: Permission, on: boolean) => void
  onOpenRole: (role: RoleRow) => void
  dragId: string | null
  itemRef: DragApi["itemRef"]
  handleProps: DragApi["handleProps"]
}) {
  const areas = PERMISSION_AREAS.map(area => ({ area, items: PERMISSIONS.filter(p => p.area === area) })).filter(a => a.items.length)
  // First permission of each area gets a divider so the groups read as blocks
  const startsArea = new Set(areas.map(a => a.items[0].key))

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-surface">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className="sticky left-0 z-20 min-w-32 sm:min-w-44 border-b border-r border-border bg-card px-3 py-2 text-left align-bottom text-xs font-semibold text-fg-muted">
                Role
              </th>
              {areas.map(({ area, items }) => (
                <th key={area} colSpan={items.length} scope="colgroup" className="border-b border-l border-border px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {area}
                </th>
              ))}
            </tr>
            <tr>
              {areas.flatMap(({ items }) => items).map(p => (
                <th
                  key={p.key}
                  scope="col"
                  className={`w-24 min-w-24 border-b border-border px-2 py-2 text-left align-bottom text-xs font-medium leading-snug ${startsArea.has(p.key) ? "border-l" : ""}`}
                >
                  <Tooltip content={p.description}>
                    <span className="cursor-help">{p.label}</span>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map(role => {
              const isAdmin = role.permissions.includes("administrator")
              // Rows with permissions you lack are read-only (the API refuses edits too)
              const rowLocked = !grantable(role.permissions)
              return (
                <tr key={role.id} ref={itemRef(role.id)} className={dragId === role.id ? "bg-surface-3" : "hover:bg-surface-2"}>
                  <th scope="row" className={`sticky left-0 z-10 border-b border-r border-border px-0 py-0 text-left font-normal ${dragId === role.id ? "bg-surface-3" : "bg-card"}`}>
                    <div className="flex items-center">
                      <button
                        {...handleProps(role.id, role.name)}
                        className="flex h-11 w-8 shrink-0 cursor-grab items-center justify-center text-fg-muted hover:text-foreground active:cursor-grabbing"
                      >
                        <GripVertical aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenRole(role)}
                        className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left hover:underline"
                      >
                        <RoleDot color={role.color} />
                        <span className="truncate font-medium">{role.name}</span>
                      </button>
                    </div>
                  </th>
                  {areas.flatMap(({ items }) => items).map(p => {
                    const explicit = role.permissions.includes(p.key)
                    const implied = isAdmin && p.key !== "administrator" && !explicit
                    const saving = savingCells.has(`${role.id}:${p.key}`)
                    const disabled = rowLocked || saving || implied || !grantable([p.key])
                    const label = `${p.label} for ${role.name}`
                    return (
                      <td key={p.key} className={`border-b border-border p-0 text-center ${startsArea.has(p.key) ? "border-l" : ""}`}>
                        <label
                          className={`flex h-11 w-full items-center justify-center ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                          title={implied ? "Granted by Administrator" : rowLocked ? "This role has permissions you don't have" : !grantable([p.key]) ? "You don't have this permission" : undefined}
                        >
                          <input
                            type="checkbox"
                            aria-label={label}
                            className={`size-4 accent-brand ${implied ? "opacity-40" : ""}`}
                            checked={explicit || implied}
                            disabled={disabled}
                            onChange={e => onToggle(role, p.key, e.target.checked)}
                          />
                        </label>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">Changes save as you tick. Faded ticks come from Administrator.</p>
    </div>
  )
}
