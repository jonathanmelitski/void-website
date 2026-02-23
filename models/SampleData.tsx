import type { Player } from "./RosterModels"
import { Team } from "./RosterModels"

export const SamplePlayers: Player[] = [
    {
        "id": "asdf-01",
        first_name: "Jon",
        last_name: "Melitski",
        number: 6,
        team: Team.void,
        is_captain: true,
        is_active: true
      }
]