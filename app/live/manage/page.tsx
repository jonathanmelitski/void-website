"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import { useRequireAuth } from "@/hooks/use-require-auth"
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
  const { signOut } = useAuth()
  const { user, isLoading } = useRequireAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get("tab")
    return (["photos", "events", "games", "players", "film", "player-links", "newsletters", "users", "audit", "marketing", "live-server"].includes(t ?? "") ? t : "photos") as Tab
  })

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
    <div className="flex min-w-0 flex-col gap-8 px-4 py-6 text-left sm:p-8 lg:px-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
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

      {/* Scrolls sideways on phones; the active tab is kept in view */}
      <div
        role="tablist"
        aria-label="Manage sections"
        className="-mx-4 -mb-4 flex items-center gap-1 overflow-x-auto overscroll-x-contain border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            ref={el => { if (el && activeTab === tab.id) el.scrollIntoView({ block: "nearest", inline: "nearest" }) }}
            onClick={() => {
              setActiveTab(tab.id)
              router.replace(`/live/manage?tab=${tab.id}`, { scroll: false })
            }}
            className={[
              "-mb-px min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors",
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
