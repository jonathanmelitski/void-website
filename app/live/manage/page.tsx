"use client"

import { Suspense, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { useAuth } from "@/lib/use-auth"
import { useRequireAuth } from "@/hooks/use-require-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// Each panel is its own chunk, loaded when its tab opens, so the first load
// doesn't carry Tiptap, the marketing tools or the film viewer.
function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  )
}

const loading = () => <PanelSkeleton />
const UserPanel = dynamic(() => import("./UserPanel").then(m => m.UserPanel), { loading })
const EventsPanel = dynamic(() => import("./EventsPanel").then(m => m.EventsPanel), { loading })
const GamesPanel = dynamic(() => import("./GamesPanel").then(m => m.GamesPanel), { loading })
const PlayersPanel = dynamic(() => import("./PlayersPanel").then(m => m.PlayersPanel), { loading })
const FilmPanel = dynamic(() => import("./FilmPanel").then(m => m.FilmPanel), { loading })
const PlayerLinksPanel = dynamic(() => import("./PlayerLinksPanel").then(m => m.PlayerLinksPanel), { loading })
const NewslettersPanel = dynamic(() => import("./NewslettersPanel").then(m => m.NewslettersPanel), { loading })
const AdminPanel = dynamic(() => import("./AdminPanel").then(m => m.AdminPanel), { loading })
const AuditPanel = dynamic(() => import("./AuditPanel").then(m => m.AuditPanel), { loading })
const MarketingPanel = dynamic(() => import("./MarketingPanel").then(m => m.MarketingPanel), { loading })
const LiveServerPanel = dynamic(() => import("./LiveServerPanel").then(m => m.LiveServerPanel), { loading })

type Tab = "photos" | "events" | "games" | "players" | "film" | "player-links" | "users" | "newsletters" | "audit" | "marketing" | "live-server"

const ALL_TABS: Tab[] = ["photos", "events", "games", "players", "film", "player-links", "newsletters", "users", "audit", "marketing", "live-server"]

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

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", COACH: "Coach", USER: "User" }

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
  // null until the user picks a tab: then the default depends on the role
  const [pickedTab, setPickedTab] = useState<Tab | null>(() => {
    const t = searchParams.get("tab")
    return ALL_TABS.includes(t as Tab) ? (t as Tab) : null
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
  // Coaches and admins mostly come here to run games, so open on Games
  const activeTab: Tab = pickedTab ?? (isCoachOrAdmin ? "games" : "photos")

  const tabs: { id: Tab; label: string }[] = [
    { id: "photos", label: "Photos" },
    ...(isCoachOrAdmin ? [{ id: "events" as Tab, label: "Events" }] : []),
    ...(isCoachOrAdmin ? [{ id: "games" as Tab, label: "Games" }] : []),
    ...(isCoachOrAdmin ? [{ id: "players" as Tab, label: "Players" }] : []),
    ...(isCoachOrAdmin ? [{ id: "film" as Tab, label: "Film" }] : []),
    ...(isCoachOrAdmin ? [{ id: "player-links" as Tab, label: "Player links" }] : []),
    ...(isCoachOrAdmin ? [{ id: "newsletters" as Tab, label: "Newsletters" }] : []),
    ...(isAdmin ? [{ id: "users" as Tab, label: "Users" }] : []),
    ...(isAdmin ? [{ id: "audit" as Tab, label: "Audit" }] : []),
    ...(isAdmin ? [{ id: "marketing" as Tab, label: "Marketing" }] : []),
    ...(isAdmin ? [{ id: "live-server" as Tab, label: "Live server" }] : []),
  ]

  return (
    <div className="flex min-w-0 flex-col gap-8 px-4 py-6 text-left sm:p-8 lg:px-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Button asChild variant="quiet" size="sm" className="mb-2">
            <Link href="/live">
              <ChevronLeft aria-hidden />
              Back
            </Link>
          </Button>
          <h1 className="text-4xl font-display leading-none tracking-wide">Manage</h1>
          <p className="text-fg-muted mt-1 text-sm">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={ROLE_VARIANT[role] ?? "outline"}>{ROLE_LABEL[role] ?? role}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 sm:h-8"
            onClick={() => signOut().then(() => router.push("/live/login"))}
          >
            Sign out
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={v => {
          setPickedTab(v as Tab)
          router.replace(`/live/manage?tab=${v}`, { scroll: false })
        }}
      >
        {/* Scrolls sideways on phones; the active tab is kept in view */}
        <TabsList aria-label="Manage sections" className="-mx-4 w-auto overscroll-x-contain px-4 sm:mx-0 sm:w-full sm:px-0">
          {tabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              ref={el => { if (el && activeTab === tab.id) el.scrollIntoView({ block: "nearest", inline: "nearest" }) }}
              className="h-11 px-4"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

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
      </Tabs>
    </div>
  )
}
