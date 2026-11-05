"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UserPanel } from "./UserPanel"
import { EventsPanel } from "./EventsPanel"
import { AdminPanel } from "./AdminPanel"
import { NewslettersPanel } from "./NewslettersPanel"
import { AuditPanel } from "./AuditPanel"
import { MarketingPanel } from "./MarketingPanel"
import { GamesPanel } from "./GamesPanel"
import { PlayersPanel } from "./PlayersPanel"
import { LiveServerPanel } from "./LiveServerPanel"
import { FilmPanel } from "./FilmPanel"
import { PlayerLinksPanel } from "./PlayerLinksPanel"
import { Spinner } from "@/components/ui/spinner"

type Tab = "photos" | "events" | "games" | "players" | "film" | "player-links" | "users" | "newsletters" | "audit" | "marketing" | "live-server"

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

export default function ManagePage() {
  return (
    <Suspense>
      <ManagePageInner />
    </Suspense>
  )
}

function ManagePageInner() {
  const { user, isLoading, signOut } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get("tab")
    return (["photos", "events", "games", "players", "film", "player-links", "newsletters", "users", "audit", "marketing", "live-server"].includes(t ?? "") ? t : "photos") as Tab
  })

  useEffect(() => {
    if (!isLoading && !user) router.replace("/live/login")
  }, [user, isLoading, router])

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh]">
        <Spinner size="md" />
      </div>
    )
  }

  const role = getHighestRole(user.groups)
  const isCoachOrAdmin = role === "COACH" || role === "ADMIN"
  const isAdmin = role === "ADMIN"

  const tabs: { id: Tab; label: string }[] = [
    { id: "photos", label: "Photos" },
    ...(isCoachOrAdmin ? [{ id: "events" as Tab, label: "Events" }] : []),
    ...(isCoachOrAdmin ? [{ id: "games" as Tab, label: "Games" }] : []),
    ...(isCoachOrAdmin ? [{ id: "players" as Tab, label: "Players" }] : []),
    ...(isCoachOrAdmin ? [{ id: "film" as Tab, label: "Film" }] : []),
    ...(isCoachOrAdmin ? [{ id: "player-links" as Tab, label: "Player Links" }] : []),
    ...(isCoachOrAdmin ? [{ id: "newsletters" as Tab, label: "Newsletters" }] : []),
    ...(isAdmin ? [{ id: "users" as Tab, label: "Users" }] : []),
    ...(isAdmin ? [{ id: "audit" as Tab, label: "Audit" }] : []),
    ...(isAdmin ? [{ id: "marketing" as Tab, label: "Marketing" }] : []),
    ...(isAdmin ? [{ id: "live-server" as Tab, label: "Live Server" }] : []),
  ]

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8 text-left">
      <div className="flex items-end justify-between">
        <div>
          <button
            onClick={() => router.push("/live")}
            className="text-fg-muted hover:text-foreground text-sm mb-2 flex items-center gap-1 transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-4xl font-display leading-none tracking-wide">Manage</h1>
          <p className="text-fg-muted mt-1 text-sm">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={ROLE_VARIANT[role] ?? "outline"}>{role}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="text-fg-muted hover:text-foreground hover:bg-surface-2"
            onClick={() => signOut().then(() => router.push("/live/login"))}
          >
            Sign out
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border -mb-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id)
              router.replace(`/live/manage?tab=${tab.id}`, { scroll: false })
            }}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-fg-muted hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === "photos" && <UserPanel />}
        {activeTab === "events" && isCoachOrAdmin && <EventsPanel />}
        {activeTab === "games" && isCoachOrAdmin && <GamesPanel />}
        {activeTab === "players" && isCoachOrAdmin && <PlayersPanel />}
        {activeTab === "film" && isCoachOrAdmin && <FilmPanel />}
        {activeTab === "player-links" && isCoachOrAdmin && <PlayerLinksPanel />}
        {activeTab === "newsletters" && isCoachOrAdmin && <NewslettersPanel />}
        {activeTab === "users" && isAdmin && <AdminPanel />}
        {activeTab === "audit" && isAdmin && <AuditPanel />}
        {activeTab === "marketing" && isAdmin && <MarketingPanel />}
        {activeTab === "live-server" && isAdmin && <LiveServerPanel />}
      </div>
    </div>
  )
}
