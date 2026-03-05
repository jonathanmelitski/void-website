"use client"

import { useState } from "react";
import PlayerCard from "./PlayerCard";
import MobileRosterCarousel from "./MobileRosterCarousel";
import { RosterProvider } from "./RosterContext";
import type { Player } from "../../models/RosterModels";

type RosterProps = {
  initialPlayers: Player[]
}

export default function RosterView({ initialPlayers }: RosterProps) {
  const [players] = useState<Player[]>(initialPlayers)

  return (
    <>
      {/* Mobile: single-context carousel */}
      <div className="md:hidden">
        <MobileRosterCarousel players={players} />
      </div>

      {/* Desktop: full grid with per-card WebGL contexts */}
      <main className="hidden md:block lg:p-16 md:p-8">
        <RosterProvider>
          <h1 className="text-6xl font-black p-12">Roster</h1>
          <div className="w-full flex justify-center">
            <ul className="grid grid-cols-1 items-center gap-8 max-w-3xl w-full">
              {players.map((el, i) => (
                <li key={el.id}>
                  <PlayerCard player={el} index={i} />
                </li>
              ))}
            </ul>
          </div>
        </RosterProvider>
      </main>
    </>
  );
}