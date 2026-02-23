import RosterView from "./RosterView";
import type { Player } from "@/models/RosterModels";
import { SamplePlayers } from "@/models/SampleData";


export default async function Roster() {
  const players: Player[] = SamplePlayers

  return (
    <div className="lg:px-16 not-lg:px-4">
      <RosterView initialPlayers={players} />
    </div>
  )
}