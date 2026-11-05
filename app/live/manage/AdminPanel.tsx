"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { Editor } from "@tiptap/react"
import { Spinner } from "@/components/ui/spinner"
import { apiFetch } from "@/lib/api-fetch"
import { useAuth } from "@/lib/use-auth"
import { toast } from "@/components/ui/sonner"
import { CONNECTION_HINT, deleteMany, friendlyError } from "./api-helpers"

// Tiptap is heavy; only load it when the invite-email dialog opens.
const SimpleEditor = dynamic(
  () => import("@/components/tiptap-templates/simple/simple-editor").then(m => m.SimpleEditor),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full rounded-none" /> },
)

type UserRow = { username: string; email: string; enabled: boolean; status: string; role: string }

const ROLES = ["USER", "COACH", "ADMIN"] as const
const ROLE_LABEL: Record<string, string> = { USER: "User", COACH: "Coach", ADMIN: "Admin" }
const ROLE_RANK: Record<string, number> = { USER: 0, COACH: 1, ADMIN: 2 }

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Active",
  FORCE_CHANGE_PASSWORD: "Invited",
  RESET_REQUIRED: "Reset required",
  UNCONFIRMED: "Unconfirmed",
}

function RoleOptions() {
  return ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)
}

type PendingRole = { user: UserRow; role: string; isSelf: boolean }

export function AdminPanel() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<UserRow[]>([])
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(true)

  // Role change state
  const [pendingRole, setPendingRole] = useState<PendingRole | null>(null)
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null)

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<UserRow[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const clearFnRef = useRef<(() => void)>(() => {})

  // Single invite state
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("USER")
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState("")

  // Bulk invite state
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState("")
  const [bulkRole, setBulkRole] = useState("USER")
  const [isBulkInviting, setIsBulkInviting] = useState(false)
  const [bulkSummary, setBulkSummary] = useState<{ succeeded: string[]; failed: Array<{ email: string; error: string }> } | null>(null)

  // Email template state
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateSubject, setTemplateSubject] = useState("")
  const [templateBody, setTemplateBody] = useState("")
  const [isTemplateLoading, setIsTemplateLoading] = useState(false)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [templateError, setTemplateError] = useState("")
  const [templateSaved, setTemplateSaved] = useState(false)
  const templateEditorRef = useRef<Editor | null>(null)

  useEffect(() => {
    loadUsers()
  }, [])

  function loadUsers() {
    setIsLoading(true)
    apiFetch("/api/admin/users")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUsers(data); else setError("Couldn't load users. Reload to try again.") })
      .catch(() => setError(`Couldn't load users. ${CONNECTION_HINT}`))
      .finally(() => setIsLoading(false))
  }

  function isSelf(u: UserRow) {
    if (!me) return false
    return u.username === me.username || (!!u.email && u.email.toLowerCase() === me.email?.toLowerCase())
  }

  function requestRoleChange(u: UserRow, role: string) {
    if (role === u.role) return
    const self = isSelf(u)
    const demoting = (ROLE_RANK[role] ?? 0) < (ROLE_RANK[u.role] ?? 0)
    if (self || demoting) {
      setPendingRole({ user: u, role, isSelf: self })
      return
    }
    void applyRoleChange(u, role)
  }

  async function applyRoleChange(u: UserRow, role: string) {
    const previous = u.role
    setSavingRoleFor(u.username)
    setUsers(prev => prev.map(x => x.username === u.username ? { ...x, role } : x))
    try {
      const res = await apiFetch("/api/admin/assign-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u.username, role }),
        waitForSession: true,
      })
      if (!res.ok) {
        setUsers(prev => prev.map(x => x.username === u.username ? { ...x, role: previous } : x))
        toast.error(await friendlyError(res, `Couldn't change ${u.email || "the user"}'s role. Try again.`))
        return
      }
      toast.success(`${u.email || "User"} is now ${ROLE_LABEL[role] ?? role}`)
    } catch {
      setUsers(prev => prev.map(x => x.username === u.username ? { ...x, role: previous } : x))
      toast.error(`Couldn't change the role. ${CONNECTION_HINT}`)
    } finally {
      setSavingRoleFor(null)
      setPendingRole(null)
    }
  }

  async function handleDelete(targets: UserRow[]) {
    setIsDeleting(true)
    const deleted = await deleteMany(
      targets,
      u => apiFetch("/api/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u.username }),
        waitForSession: true,
      }),
      { one: "user", many: "users" },
    )
    const deletedUsernames = new Set(deleted.map(u => u.username))
    if (deletedUsernames.size > 0) setUsers(prev => prev.filter(u => !deletedUsernames.has(u.username)))
    setIsDeleting(false)
    setDeleteTarget(null)
  }

  async function handleInvite(e?: React.FormEvent) {
    e?.preventDefault()
    if (!inviteEmail.trim()) { setInviteError("Enter an email address."); return }
    setIsInviting(true)
    setInviteError("")
    try {
      const res = await apiFetch("/api/admin/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        waitForSession: true,
      })
      if (!res.ok) { setInviteError(await friendlyError(res, "Couldn't send the invite. Check the address and try again.")); return }
      const data = await res.json()
      const newUser: UserRow = {
        username: data.username,
        email: data.email,
        enabled: true,
        status: data.status,
        role: data.role,
      }
      setUsers(prev => [newUser, ...prev])
      setInviteEmail("")
      toast.success(`Invite sent to ${data.email}`)
    } catch {
      setInviteError(`Couldn't send the invite. ${CONNECTION_HINT}`)
    } finally {
      setIsInviting(false)
    }
  }

  async function handleBulkInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!bulkText.trim()) return
    setIsBulkInviting(true)
    setBulkSummary(null)
    try {
      const res = await apiFetch("/api/admin/invite-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: bulkText, role: bulkRole }),
        waitForSession: true,
      })
      if (!res.ok) {
        setBulkSummary({ succeeded: [], failed: [{ email: "", error: await friendlyError(res, "Couldn't send the invites. Try again.") }] })
        return
      }
      setBulkSummary(await res.json())
    } catch {
      setBulkSummary({ succeeded: [], failed: [{ email: "", error: `Couldn't send the invites. ${CONNECTION_HINT}` }] })
    } finally {
      setIsBulkInviting(false)
    }
  }

  function handleBulkDismiss() {
    setBulkOpen(false)
    setBulkText("")
    setBulkRole("USER")
    if (bulkSummary) loadUsers()
    setBulkSummary(null)
  }

  async function openTemplateDialog() {
    setTemplateOpen(true)
    setTemplateError("")
    setTemplateSaved(false)
    setIsTemplateLoading(true)
    try {
      const res = await apiFetch("/api/admin/invite-template")
      if (res.ok) {
        const data = await res.json()
        setTemplateSubject(data.subject)
        setTemplateBody(data.bodyHtml)
      } else {
        setTemplateError(await friendlyError(res, "Couldn't load the invite email. Close and try again."))
      }
    } catch {
      setTemplateError(`Couldn't load the invite email. ${CONNECTION_HINT}`)
    } finally {
      setIsTemplateLoading(false)
    }
  }

  async function handleSaveTemplate() {
    const html = templateEditorRef.current?.getHTML() ?? templateBody
    setIsSavingTemplate(true)
    setTemplateError("")
    setTemplateSaved(false)
    try {
      const res = await apiFetch("/api/admin/invite-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: templateSubject, bodyHtml: html }),
        waitForSession: true,
      })
      if (!res.ok) { setTemplateError(await friendlyError(res, "Couldn't save the invite email. Try again.")); return }
      setTemplateSaved(true)
      toast.success("Invite email saved")
    } catch {
      setTemplateError(`Couldn't save the invite email. ${CONNECTION_HINT}`)
    } finally {
      setIsSavingTemplate(false)
    }
  }

  function roleSelect(u: UserRow, className?: string) {
    return (
      <NativeSelect
        aria-label={`Role for ${u.email || u.username}`}
        value={u.role}
        disabled={savingRoleFor === u.username}
        onChange={e => requestRoleChange(u, e.target.value)}
        className={className ?? "w-28"}
      >
        <RoleOptions />
      </NativeSelect>
    )
  }

  function statusBadge(u: UserRow) {
    return (
      <Badge variant="outline" className="shrink-0 text-xs text-fg-muted border-border">
        {STATUS_LABEL[u.status] ?? u.status}
      </Badge>
    )
  }

  const columns: ColumnDef<UserRow>[] = [
    {
      header: "Email",
      cell: u => (
        <span>
          {u.email || u.username}
          {isSelf(u) && <span className="ml-2 text-xs text-fg-muted">(you)</span>}
        </span>
      ),
    },
    { header: "Status", cell: u => statusBadge(u) },
    { header: "Role", cell: u => roleSelect(u) },
  ]

  if (error) return <p className="text-sm text-destructive">{error}</p>

  const pendingDemotesSelfAdmin = pendingRole?.isSelf && pendingRole.user.role === "ADMIN"

  return (
    <div className="flex flex-col gap-4 text-left">
      {/* Invite controls */}
      <form onSubmit={handleInvite} noValidate className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Invite user" error={inviteError} className="w-full sm:w-72">
            <Input
              type="email"
              placeholder="name@example.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              className="h-10 sm:h-9"
            />
          </Field>
          <NativeSelect
            aria-label="Role for the invite"
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="w-28 [&>select]:h-10 sm:[&>select]:h-9"
          >
            <RoleOptions />
          </NativeSelect>
          <Button type="submit" className="h-10 sm:h-9" loading={isInviting}>
            Send invite
          </Button>
        </div>
        <div className="-ml-3 flex flex-wrap items-center">
          <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setBulkOpen(true)}>
            Bulk invite
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-8" onClick={openTemplateDialog}>
            Customize invite email
          </Button>
        </div>
      </form>

      <DataTable
        columns={columns}
        data={users}
        isLoading={isLoading}
        emptyMessage="No users yet. Invite someone above."
        getRowKey={u => u.username}
        mobileCard={u => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-all font-medium">
                {u.email || u.username}
                {isSelf(u) && <span className="ml-2 text-xs font-normal text-fg-muted">(you)</span>}
              </p>
              {statusBadge(u)}
            </div>
            {roleSelect(u, "w-full [&>select]:h-10")}
          </div>
        )}
        toolbar={(selectedRows, clearSelection) => {
          clearFnRef.current = clearSelection
          if (selectedRows.length === 0) return null
          return (
            <div className="flex items-center gap-3">
              <span className="text-sm text-fg-muted">{selectedRows.length} selected</span>
              <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(selectedRows)}>
                Delete
              </Button>
            </div>
          )
        }}
      />

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={open => { if (!open && !savingRoleFor) setPendingRole(null) }}
        title={pendingRole?.isSelf ? "Change your own role?" : `Make ${pendingRole?.user.email || "this user"} ${ROLE_LABEL[pendingRole?.role ?? ""] ?? ""}?`}
        description={
          pendingRole?.isSelf
            ? pendingDemotesSelfAdmin
              ? "You'll lose admin access right away, including Users, Audit, Marketing and Live Server. Another admin will have to restore it."
              : `Your role changes to ${ROLE_LABEL[pendingRole.role] ?? pendingRole.role}.`
            : <>
                <span className="font-medium text-foreground">{pendingRole?.user.email || pendingRole?.user.username}</span>{" "}
                goes from {ROLE_LABEL[pendingRole?.user.role ?? ""]} to {ROLE_LABEL[pendingRole?.role ?? ""]} and loses access that comes with their current role.
              </>
        }
        confirmLabel={pendingRole?.isSelf ? "Change my role" : `Make ${ROLE_LABEL[pendingRole?.role ?? ""] ?? ""}`}
        destructive
        isLoading={savingRoleFor !== null}
        onConfirm={() => pendingRole && applyRoleChange(pendingRole.user, pendingRole.role)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => { if (!open && !isDeleting) setDeleteTarget(null) }}
        title={`Delete ${deleteTarget && deleteTarget.length > 1 ? `${deleteTarget.length} users` : "user"}?`}
        description={
          deleteTarget?.length === 1
            ? <><span className="font-medium text-foreground">{deleteTarget[0].email || deleteTarget[0].username}</span> loses access to Void Live. This can&apos;t be undone.</>
            : "These users lose access to Void Live. This can't be undone."
        }
        confirmLabel={deleteTarget && deleteTarget.length > 1 ? `Delete ${deleteTarget.length} users` : "Delete user"}
        isLoading={isDeleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
      />

      {/* Bulk invite dialog */}
      <Dialog open={bulkOpen} onOpenChange={open => { if (!open && !isBulkInviting) handleBulkDismiss() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk invite</DialogTitle>
          </DialogHeader>

          {bulkSummary ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-foreground">
                {bulkSummary.succeeded.length} invited
                {bulkSummary.failed.length > 0 && `, ${bulkSummary.failed.length} failed`}
              </p>
              {bulkSummary.failed.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {bulkSummary.failed.map(f => (
                    <li key={f.email} className="text-destructive">
                      {f.email ? `${f.email}: ` : ""}{f.error}
                    </li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button onClick={handleBulkDismiss}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleBulkInvite} noValidate className="flex flex-col gap-4">
              <Field label="Emails" hint="One per line, or comma-separated">
                <Textarea
                  className="min-h-32 resize-none"
                  placeholder="name@example.com"
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                />
              </Field>
              <Field label="Role" className="w-40">
                <NativeSelect value={bulkRole} onChange={e => setBulkRole(e.target.value)}>
                  <RoleOptions />
                </NativeSelect>
              </Field>
              <DialogFooter className="pt-2">
                <Button type="button" variant="ghost" onClick={handleBulkDismiss} disabled={isBulkInviting}>Cancel</Button>
                <Button type="submit" loading={isBulkInviting} disabled={!bulkText.trim()}>
                  Send invites
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Email template dialog */}
      <Dialog open={templateOpen} onOpenChange={open => { if (!open) { setTemplateOpen(false); setTemplateSaved(false) } }}>
        <DialogContent className="max-w-2xl w-full p-0 overflow-hidden flex flex-col max-h-[90vh]">
          <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
            <DialogTitle>Customize invite email</DialogTitle>
          </DialogHeader>

          {isTemplateLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : (
            <div className="flex flex-col gap-5 px-6 py-5 overflow-y-auto flex-1 min-h-0">
              {/* Placeholders legend */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-fg-muted">Available placeholders:</span>
                {[
                  { tag: "{username}", desc: "recipient email" },
                  { tag: "{####}", desc: "temporary password" },
                ].map(p => (
                  <span
                    key={p.tag}
                    title={p.desc}
                    className="font-mono text-xs px-2 py-0.5 rounded-md bg-surface border border-border text-fg-secondary cursor-default select-all"
                  >
                    {p.tag}
                  </span>
                ))}
              </div>

              <Field label="Subject">
                <Input
                  value={templateSubject}
                  onChange={e => setTemplateSubject(e.target.value)}
                  placeholder="You're invited to Void Live"
                />
              </Field>

              {/* Body */}
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium text-fg-secondary">
                  Body <span className="text-fg-muted font-normal">— must include {"{username}"} and {"{####}"}</span>
                </p>
                <div className="rounded-xl border border-border overflow-hidden">
                  <SimpleEditor
                    key={templateBody}
                    initialContent={templateBody}
                    onEditorReady={editor => { templateEditorRef.current = editor }}
                    onChange={() => { setTemplateSaved(false) }}
                  />
                </div>
              </div>

              {templateError && <p role="alert" className="text-sm text-destructive">{templateError}</p>}
            </div>
          )}

          <div className="px-6 pb-6 pt-3 flex flex-wrap items-center justify-between gap-2 shrink-0 border-t border-border">
            <span className="text-xs text-fg-muted">
              {templateSaved ? "Saved" : "Changes apply to all future invites"}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setTemplateOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveTemplate} loading={isSavingTemplate} disabled={!templateSubject.trim()}>
                Save changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
