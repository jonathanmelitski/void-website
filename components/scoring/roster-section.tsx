"use client"

import { useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { apiFetch } from "@/lib/api-fetch"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/sonner"
import type { PlayerItem } from "@/lib/aws/players"
import type { GamePlayerItem } from "@/lib/aws/game-players"
import { PlayerTile } from "./player-tile"
import { SCORING_TOAST, SCORING_WRITE, byDisplayName } from "./shared"

type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error"

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  pending: "Not saved yet",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved",
}
const STATUS_COLOR: Record<SaveStatus, string> = {
  idle: "",
  pending: "text-fg-muted",
  saving: "text-fg-muted",
  saved: "text-success",
  error: "text-destructive",
}

/**
 * Who is at the game. Taps update the tiles at once and save after a short pause. The save status
 * lives in a fixed-width slot in the header, so it never reflows the grid under the next tap.
 * A failed save puts the affected players back the way the server has them.
 */
export function RosterSection({
  players,
  gamePlayers,
  gameId,
  onRosterChange,
  defaultOpen,
}: {
  players: PlayerItem[]
  gamePlayers: GamePlayerItem[]
  gameId: string
  onRosterChange: (gps: GamePlayerItem[]) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [pendingIds, setPendingIdsState] = useState<Set<string>>(() => new Set(gamePlayers.map(gp => gp.playerId)))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")

  // Refs so the debounced flush always sees the latest values without stale closures
  const pendingIdsRef = useRef<Set<string>>(new Set(gamePlayers.map(gp => gp.playerId)))
  const committedRef = useRef<GamePlayerItem[]>(gamePlayers)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const againRef = useRef(false)

  const activePlayers = players.filter(p => p.is_active).sort(byDisplayName)
  const allSelected = activePlayers.length > 0 && activePlayers.every(p => pendingIds.has(p.id))

  function setPendingIds(next: Set<string>) {
    pendingIdsRef.current = next
    setPendingIdsState(next)
  }

  function schedule() {
    setSaveStatus("pending")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(flush, 800)
  }

  function togglePlayer(player: PlayerItem) {
    const next = new Set(pendingIdsRef.current)
    if (next.has(player.id)) next.delete(player.id)
    else next.add(player.id)
    setPendingIds(next)
    schedule()
  }

  function selectAll() {
    setPendingIds(allSelected ? new Set<string>() : new Set(activePlayers.map(p => p.id)))
    schedule()
  }

  async function flush() {
    if (inFlightRef.current) { againRef.current = true; return }
    const latest = pendingIdsRef.current
    const committed = committedRef.current
    const committedIds = new Set(committed.map(gp => gp.playerId))
    const toAdd = [...latest].filter(id => !committedIds.has(id))
    const toRemove = committed.filter(gp => !latest.has(gp.playerId))

    if (toAdd.length === 0 && toRemove.length === 0) {
      setSaveStatus("idle")
      return
    }

    inFlightRef.current = true
    setSaveStatus("saving")
    const [added, removed] = await Promise.all([
      Promise.all(toAdd.map(async playerId => {
        try {
          const r = await apiFetch("/api/game-players", {
            ...SCORING_WRITE,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameId, playerId }),
          })
          return r.ok ? { playerId, item: (await r.json()) as GamePlayerItem } : { playerId, item: null }
        } catch {
          return { playerId, item: null }
        }
      })),
      Promise.all(toRemove.map(async gp => {
        try {
          const r = await apiFetch(`/api/game-players/${gp.id}?gameId=${gameId}`, { ...SCORING_WRITE, method: "DELETE" })
          return { gp, ok: r.ok || r.status === 404 }
        } catch {
          return { gp, ok: false }
        }
      })),
    ])
    inFlightRef.current = false

    const removedIds = new Set(removed.filter(r => r.ok).map(r => r.gp.id))
    const newCommitted = [
      ...committed.filter(gp => !removedIds.has(gp.id)),
      ...added.flatMap(a => (a.item ? [a.item] : [])),
    ]
    committedRef.current = newCommitted
    onRosterChange(newCommitted)

    const failedAdds = added.filter(a => !a.item).map(a => a.playerId)
    const failedRemoves = removed.filter(r => !r.ok).map(r => r.gp.playerId)
    const failures = failedAdds.length + failedRemoves.length
    if (failures > 0) {
      // Show what the server actually has for the players that didn't save; keep any newer taps.
      const next = new Set(pendingIdsRef.current)
      failedAdds.forEach(id => next.delete(id))
      failedRemoves.forEach(id => next.add(id))
      setPendingIds(next)
      setSaveStatus("error")
      toast.error(
        failures === 1 ? "Couldn't save attendance for 1 player." : `Couldn't save attendance for ${failures} players.`,
        { ...SCORING_TOAST, description: "Check your connection and tap them again." }
      )
      return
    }

    if (againRef.current) {
      againRef.current = false
      flush()
      return
    }
    setSaveStatus("saved")
    setTimeout(() => setSaveStatus(prev => (prev === "saved" ? "idle" : prev)), 2000)
  }

  return (
    <section aria-labelledby="roster-heading">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="roster-panel"
          onClick={() => setOpen(o => !o)}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md text-left"
        >
          <ChevronRight aria-hidden className={cn("size-5 shrink-0 text-fg-muted transition-transform motion-reduce:transition-none", open && "rotate-90")} />
          <h2 id="roster-heading" className="whitespace-nowrap text-lg font-semibold">Roster</h2>
          <span className="whitespace-nowrap text-sm text-fg-muted">
            {pendingIds.size} attending
          </span>
        </button>
        <span aria-live="polite" className={cn("w-24 shrink-0 whitespace-nowrap text-right text-xs", STATUS_COLOR[saveStatus])}>
          {STATUS_LABEL[saveStatus]}
        </span>
      </div>

      {open && (
        <div id="roster-panel" className="mt-2 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm text-fg-muted">Tap who is here today.</p>
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={selectAll} disabled={activePlayers.length === 0}>
              {allSelected ? "Clear all" : "Select all"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {activePlayers.map(player => (
              <PlayerTile key={player.id} player={player} selected={pendingIds.has(player.id)} onClick={() => togglePlayer(player)} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
