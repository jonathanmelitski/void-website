"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UserPanel } from "./UserPanel"
import { CoachPanel } from "./CoachPanel"
import { AdminPanel } from "./AdminPanel"

type Tab = "photos" | "events" | "users"

function getHighestRole(groups: string[]) {
  if (groups.includes("ADMIN")) return "ADMIN"
  if (groups.includes("COACH")) return "COACH"
  return "USER"
}

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  ADMIN: "default",
  COACH: "secondary",
  USER: "outline",
}

export default function DashboardPage() {
  const { user, isLoading, signOut } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>("photos")

  useEffect(() => {
    if (!isLoading && !user) router.replace("/live/login")
  }, [user, isLoading, router])

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  const role = getHighestRole(user.groups)
  const isCoachOrAdmin = role === "COACH" || role === "ADMIN"
  const isAdmin = role === "ADMIN"

  const tabs: { id: Tab; label: string }[] = [
    { id: "photos", label: "Photos" },
    ...(isCoachOrAdmin ? [{ id: "events" as Tab, label: "Events" }] : []),
    ...(isAdmin ? [{ id: "users" as Tab, label: "Users" }] : []),
  ]

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8 text-left">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-black">Void Live</h1>
          <p className="text-white/50 mt-1 text-sm">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={ROLE_VARIANT[role] ?? "outline"}>{role}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/40 hover:text-white hover:bg-white/10"
            onClick={() => signOut().then(() => router.push("/live/login"))}
          >
            Sign out
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-white/10 -mb-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-white text-white"
                : "border-transparent text-white/40 hover:text-white/70",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "photos" && <UserPanel />}
        {activeTab === "events" && isCoachOrAdmin && <CoachPanel />}
        {activeTab === "users" && isAdmin && <AdminPanel />}
      </div>
    </div>
  )
}
