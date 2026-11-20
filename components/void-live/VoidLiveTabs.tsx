"use client"

import { useState } from "react"
import { useAuth } from "@/lib/use-auth"
import { RoleBadges } from "@/components/role-badges"
import { can } from "@/lib/permissions/catalog"
import { Button } from "@/components/ui/button"
import { UserPanel } from "@/app/live/manage/UserPanel"
import { EventsPanel } from "@/app/live/manage/EventsPanel"
import { AdminPanel } from "@/app/live/manage/AdminPanel"

type Tab = "photos" | "events" | "users"

interface VoidLiveTabsProps {
  onClose: () => void
}

export function VoidLiveTabs({ onClose }: VoidLiveTabsProps) {
  const { user, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>("photos")

  if (!user) return null

  const tabs: { id: Tab; label: string }[] = [
    ...(can(user.permissions, "photos.upload") ? [{ id: "photos" as Tab, label: "Photos" }] : []),
    ...(can(user.permissions, "events.manage") ? [{ id: "events" as Tab, label: "Events" }] : []),
    ...(can(user.permissions, "users.manage") ? [{ id: "users" as Tab, label: "Users" }] : []),
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
                ? "bg-surface-2 text-foreground"
                : "text-fg-muted hover:text-foreground hover:bg-surface-2",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <RoleBadges roles={user.roles} isOwner={user.isOwner} />
          <Button
            variant="ghost"
            size="xs"
            className="text-fg-muted hover:text-foreground hover:bg-surface-2"
            onClick={() => { signOut(); onClose() }}
          >
            Sign out
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-4 text-foreground">
        {activeTab === "photos" && tabs.some(t => t.id === "photos") && <UserPanel />}
        {activeTab === "events" && tabs.some(t => t.id === "events") && <EventsPanel />}
        {activeTab === "users" && tabs.some(t => t.id === "users") && <AdminPanel />}
      </div>
    </div>
  )
}
