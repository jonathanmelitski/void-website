import RosterView from "./RosterView";
import type { Player } from "@/models/RosterModels";
import { SamplePlayers } from "@/models/SampleData";


export default async function Roster() {
  const players: Player[] = SamplePlayers.sort((a, b) => {
    if (a.is_captain && !b.is_captain) {
      return -1
    }
    if (!a.is_captain && b.is_captain) {
      return 1
    }
    return (a.last_name < b.last_name) ? -1 : 1
  })

  return (
    <div className="lg:px-16 not-lg:px-4">
      <RosterView initialPlayers={players} />
    </div>
  )
}