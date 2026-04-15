"use client"
import { Navbar } from "./navbar-01"
import { useEffect, useState } from "react"

type LiveGame = { id: string; opponent: string }

export default function NavigationBar() {
  const [liveGame, setLiveGame] = useState<LiveGame | null>(null)

  useEffect(() => {
    fetch("/api/games/live")
      .then(r => r.json())
      .then(d => setLiveGame(Array.isArray(d) && d.length > 0 ? d[0] : null))
      .catch(() => {})
  }, [])

  return <Navbar ctaText="Void Live" liveGame={liveGame} />
}
