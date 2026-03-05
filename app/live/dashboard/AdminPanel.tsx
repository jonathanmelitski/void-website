"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

type UserRow = { username: string; email: string; enabled: boolean; status: string; role: string }

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  ADMIN: "default", COACH: "secondary", USER: "outline",
}

export function AdminPanel() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(true)

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

  if (isLoading) return <p className="text-sm text-white/40">Loading users…</p>
  if (error) return <p className="text-sm text-red-400">{error}</p>

  return (
    <div className="flex flex-col gap-4 text-left">
      <table className="w-full text-sm max-w-2xl">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-2 pr-6 font-medium text-white/40">Email</th>
            <th className="text-left py-2 pr-6 font-medium text-white/40">Status</th>
            <th className="text-left py-2 font-medium text-white/40">Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.username} className="border-b border-white/5">
              <td className="py-2.5 pr-6 text-white/80">{user.email || user.username}</td>
              <td className="py-2.5 pr-6">
                <Badge variant="outline" className="text-xs text-white/40 border-white/10">{user.status}</Badge>
              </td>
              <td className="py-2.5">
                <div className="flex items-center gap-2">
                  <Badge variant={ROLE_VARIANT[user.role] ?? "outline"}>{user.role}</Badge>
                  <Select value={user.role} onValueChange={role => handleRoleChange(user.username, role)}>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
