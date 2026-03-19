"use client"

import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor"
import type { Editor } from "@tiptap/react"

type UserRow = { username: string; email: string; enabled: boolean; status: string; role: string }

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  ADMIN: "default", COACH: "secondary", USER: "outline",
}

export function AdminPanel() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(true)

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
    fetch("/api/admin/users")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUsers(data); else setError(data.error ?? "Failed to load users") })
      .catch(() => setError("Failed to load users"))
      .finally(() => setIsLoading(false))
  }

  async function handleRoleChange(username: string, role: string) {
    setUsers(prev => prev.map(u => u.username === username ? { ...u, role } : u))
    const res = await fetch("/api/admin/assign-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, role }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed to update role") }
  }

  async function handleDelete(targets: UserRow[], clearSelection: () => void) {
    setIsDeleting(true)
    try {
      await Promise.all(targets.map(u =>
        fetch("/api/admin/delete-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: u.username }),
        })
      ))
      const deletedUsernames = new Set(targets.map(u => u.username))
      setUsers(prev => prev.filter(u => !deletedUsernames.has(u.username)))
      clearSelection()
    } catch {
      setError("Failed to delete user(s)")
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setIsInviting(true)
    setInviteError("")
    try {
      const res = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) { setInviteError(data.error ?? "Failed to invite user"); return }
      const newUser: UserRow = {
        username: data.username,
        email: data.email,
        enabled: true,
        status: data.status,
        role: data.role,
      }
      setUsers(prev => [newUser, ...prev])
      setInviteEmail("")
    } catch {
      setInviteError("Failed to invite user")
    } finally {
      setIsInviting(false)
    }
  }

  async function handleBulkInvite() {
    setIsBulkInviting(true)
    setBulkSummary(null)
    try {
      const res = await fetch("/api/admin/invite-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: bulkText, role: bulkRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBulkSummary({ succeeded: [], failed: [{ email: "", error: data.error ?? "Request failed" }] })
        return
      }
      setBulkSummary(data)
    } catch {
      setBulkSummary({ succeeded: [], failed: [{ email: "", error: "Request failed" }] })
    } finally {
      setIsBulkInviting(false)
    }
  }

  function handleBulkDismiss() {
    setBulkOpen(false)
    setBulkText("")
    setBulkRole("USER")
    setBulkSummary(null)
    loadUsers()
  }

  async function openTemplateDialog() {
    setTemplateOpen(true)
    setTemplateError("")
    setTemplateSaved(false)
    setIsTemplateLoading(true)
    try {
      const res = await fetch("/api/admin/invite-template")
      const data = await res.json()
      if (res.ok) {
        setTemplateSubject(data.subject)
        setTemplateBody(data.bodyHtml)
      } else {
        setTemplateError(data.error ?? `Error ${res.status}`)
      }
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Failed to load template")
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
      const res = await fetch("/api/admin/invite-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: templateSubject, bodyHtml: html }),
      })
      const data = await res.json()
      if (!res.ok) { setTemplateError(data.error ?? "Failed to save template"); return }
      setTemplateSaved(true)
    } catch {
      setTemplateError("Failed to save template")
    } finally {
      setIsSavingTemplate(false)
    }
  }

  const columns: ColumnDef<UserRow>[] = [
    { header: "Email", cell: u => u.email || u.username },
    {
      header: "Status",
      cell: u => (
        <Badge variant="outline" className="text-xs text-white/40 border-white/10">{u.status}</Badge>
      ),
    },
    {
      header: "Role",
      cell: u => (
        <div className="flex items-center gap-2">
          <Badge variant={ROLE_VARIANT[u.role] ?? "outline"}>{u.role}</Badge>
          <Select value={u.role} onValueChange={role => handleRoleChange(u.username, role)}>
            <SelectTrigger size="sm" className="w-24 bg-white/5 border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USER">USER</SelectItem>
              <SelectItem value="COACH">COACH</SelectItem>
              <SelectItem value="ADMIN">ADMIN</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ),
    },
  ]

  if (error) return <p className="text-sm text-red-400">{error}</p>

  return (
    <div className="flex flex-col gap-4 text-left">
      {/* Invite controls */}
      <div className="flex flex-col gap-2">
        <Label className="text-sm text-white/60">Invite user</Label>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="email"
            placeholder="user@example.com"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleInvite() }}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 max-w-xs"
          />
          <Select value={inviteRole} onValueChange={setInviteRole}>
            <SelectTrigger size="sm" className="w-28 bg-white/5 border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USER">USER</SelectItem>
              <SelectItem value="COACH">COACH</SelectItem>
              <SelectItem value="ADMIN">ADMIN</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleInvite} disabled={isInviting || !inviteEmail.trim()}>
            {isInviting ? "Inviting…" : "Invite"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
            Bulk invite
          </Button>
          <Button size="sm" variant="ghost" className="text-white/40 hover:text-white/70" onClick={openTemplateDialog}>
            Customize email
          </Button>
        </div>
        {inviteError && <p className="text-xs text-red-400">{inviteError}</p>}
      </div>

      <DataTable
        columns={columns}
        data={users}
        isLoading={isLoading}
        emptyMessage="No users found."
        getRowKey={u => u.username}
        toolbar={(selectedRows, clearSelection) => {
          clearFnRef.current = clearSelection
          if (selectedRows.length === 0) return null
          return (
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/50">{selectedRows.length} selected</span>
              <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(selectedRows)}>
                Delete
              </Button>
            </div>
          )
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title={`Delete ${deleteTarget && deleteTarget.length > 1 ? `${deleteTarget.length} users` : "user"}?`}
        description="This will permanently remove the user(s) from Cognito. This action cannot be undone."
        isLoading={isDeleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget, clearFnRef.current)}
      />

      {/* Bulk invite dialog */}
      <Dialog open={bulkOpen} onOpenChange={open => { if (!open) handleBulkDismiss() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk invite users</DialogTitle>
          </DialogHeader>

          {bulkSummary ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-white/80">
                {bulkSummary.succeeded.length} invited
                {bulkSummary.failed.length > 0 && `, ${bulkSummary.failed.length} failed`}
              </p>
              {bulkSummary.failed.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {bulkSummary.failed.map(f => (
                    <li key={f.email} className="text-red-400">
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
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm text-white/60">Emails</Label>
                <textarea
                  className="min-h-32 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                  placeholder="One email per line, or comma-separated"
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm text-white/60">Role</Label>
                <Select value={bulkRole} onValueChange={setBulkRole}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">USER</SelectItem>
                    <SelectItem value="COACH">COACH</SelectItem>
                    <SelectItem value="ADMIN">ADMIN</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleBulkDismiss}>Cancel</Button>
                <Button onClick={handleBulkInvite} disabled={isBulkInviting || !bulkText.trim()}>
                  {isBulkInviting ? "Inviting…" : "Invite all"}
                </Button>
              </DialogFooter>
            </div>
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
              <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col gap-5 px-6 py-5 overflow-y-auto flex-1 min-h-0">
              {/* Placeholders legend */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-white/40">Available placeholders:</span>
                {[
                  { tag: "{username}", desc: "recipient email" },
                  { tag: "{####}", desc: "temporary password" },
                ].map(p => (
                  <span
                    key={p.tag}
                    title={p.desc}
                    className="font-mono text-xs px-2 py-0.5 rounded bg-white/[0.06] border border-white/10 text-white/70 cursor-default select-all"
                  >
                    {p.tag}
                  </span>
                ))}
              </div>

              {/* Subject */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-white/50">Subject</Label>
                <Input
                  value={templateSubject}
                  onChange={e => setTemplateSubject(e.target.value)}
                  placeholder="You're invited to Void Live"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                />
              </div>

              {/* Body */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-white/50">
                  Body <span className="text-white/25 font-normal">— must include {"{username}"} and {"{####}"}</span>
                </Label>
                <div className="rounded-lg border border-white/10 overflow-hidden">
                  <SimpleEditor
                    key={templateBody}
                    initialContent={templateBody}
                    onEditorReady={editor => { templateEditorRef.current = editor }}
                    onChange={() => { setTemplateSaved(false) }}
                  />
                </div>
              </div>

              {templateError && <p className="text-xs text-red-400">{templateError}</p>}
            </div>
          )}

          <div className="px-6 pb-6 pt-3 flex items-center justify-between shrink-0 border-t border-white/10">
            <span className="text-xs text-white/30">
              {templateSaved ? "Saved" : "Changes will apply to all future invites"}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setTemplateOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveTemplate} disabled={isSavingTemplate || !templateSubject.trim()}>
                {isSavingTemplate ? "Saving…" : "Save template"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
