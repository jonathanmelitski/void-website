"use client"

import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

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

  useEffect(() => {
    fetch("/api/admin/users")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUsers(data); else setError(data.error ?? "Failed to load users") })
      .catch(() => setError("Failed to load users"))
      .finally(() => setIsLoading(false))
  }, [])

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
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteTarget(selectedRows)}
              >
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
    </div>
  )
}
