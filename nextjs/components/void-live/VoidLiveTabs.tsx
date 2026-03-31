"use client"

import { useState } from "react"
import { useAuth } from "@/lib/use-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UserPanel } from "@/app/live/manage/UserPanel"
import { EventsPanel } from "@/app/live/manage/EventsPanel"
import { AdminPanel } from "@/app/live/manage/AdminPanel"

type Tab = "photos" | "events" | "users"

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  ADMIN: "default",
  COACH: "secondary",
  USER: "outline",
}

function getHighestRole(groups: string[]) {
  if (groups.includes("ADMIN")) return "ADMIN"
  if (groups.includes("COACH")) return "COACH"
  return "USER"
}

interface VoidLiveTabsProps {
  onClose: () => void
}

export function VoidLiveTabs({ onClose }: VoidLiveTabsProps) {
  const { user, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>("photos")

  if (!user) return null

  const role = getHighestRole(user.groups)
  const isCoachOrAdmin = role === "COACH" || role === "ADMIN"
  const isAdmin = role === "ADMIN"

  const tabs: { id: Tab; label: string }[] = [
    { id: "photos", label: "Photos" },
    ...(isCoachOrAdmin ? [{ id: "events" as Tab, label: "Events" }] : []),
    ...(isAdmin ? [{ id: "users" as Tab, label: "Users" }] : []),
  ]

  return (
    <div className="flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 pt-3 pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              "px-4 py-2 text-sm font-medium rounded-md transition-colors",
              activeTab === tab.id
                ? "bg-white/15 text-white"
                : "text-white/40 hover:text-white/70 hover:bg-white/5",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <Badge variant={ROLE_VARIANT[role] ?? "outline"} className="text-xs">
            {role}
          </Badge>
          <Button
            variant="ghost"
            size="xs"
            className="text-white/40 hover:text-white hover:bg-white/10"
            onClick={() => { signOut(); onClose() }}
          >
            Sign out
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-4 text-white">
        {activeTab === "photos" && <UserPanel />}
        {activeTab === "events" && isCoachOrAdmin && <EventsPanel />}
        {activeTab === "users" && isAdmin && <AdminPanel />}
      </div>
    </div>
  )
}
