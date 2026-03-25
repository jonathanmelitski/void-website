import RosterView from "./RosterView";
import type { Player } from "@/models/RosterModels";
import { SamplePlayers } from "@/models/SampleData";

async function getPlayers(): Promise<Player[]> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const res = await fetch(`${base}/api/players`, { cache: "no-store" })
    if (!res.ok) throw new Error("API unavailable")
    return res.json()
  } catch {
    // Fall back to hardcoded data if the players table hasn't been provisioned yet
    return SamplePlayers
  }
}

export default async function Roster() {
  const raw = await getPlayers()
  const players: Player[] = [...raw].sort((a, b) => {
    if (a.is_captain && !b.is_captain) return -1
    if (!a.is_captain && b.is_captain) return 1
    return a.last_name.localeCompare(b.last_name)
  })

  return (
    <div className="lg:px-16 not-lg:px-4">
      <RosterView initialPlayers={players} />
    </div>
  )
}