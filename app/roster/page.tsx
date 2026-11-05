import { Users } from "lucide-react"
import RosterView from "./RosterView"
import { Team, type Player } from "@/models/RosterModels"
import { listPlayers } from "@/lib/aws/players"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page"

// The roster changes rarely; serve a cached render and refresh it in the background
export const revalidate = 300

export default async function Roster() {
  let players: Player[]
  try {
    // Archived players and other teams' players never appear on the public roster.
    // listPlayers() already orders captains first, then by last name.
    players = (await listPlayers())
      .filter(p => p.is_active && p.team === "VOID")
      .map(p => ({ ...p, team: Team.void }))
  } catch (err) {
    console.error("Roster: failed to load players", err)
    return (
      <div className="px-4 lg:px-16">
        <EmptyState
          variant="page"
          icon={<Users className="size-6" />}
          title="The roster isn't available right now"
          description="Please check back in a few minutes."
        />
      </div>
    )
  }

  if (players.length === 0) {
    return (
      <div className="px-4 lg:px-16">
        <EmptyState variant="page" icon={<Users className="size-6" />} title="No players yet" description="The roster will appear here once players are added." />
      </div>
    )
  }

  return (
    <PageContainer width="wide" className="pt-4 md:pt-6 lg:pt-8">
      <RosterView initialPlayers={players} />
    </PageContainer>
  )
}
