"use client"

import React, { useEffect, useState, useCallback, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StepProgress } from "@/components/ui/step-progress"
import type { StepDef } from "@/lib/step-types"
import type { GameItem, GameStatus } from "@/lib/aws/games"
import type { PlayerItem } from "@/lib/aws/players"
import type { GamePlayerItem } from "@/lib/aws/game-players"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"

const STATUS_VARIANT: Record<GameStatus, "default" | "secondary" | "outline"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "secondary",
  FINAL: "default",
}

const EVENT_TYPE_LABELS: Record<PointEventType, string> = {
  GOAL: "Goal",
  ASSIST: "Assist",
  TURNOVER: "Turnover",
  BLOCK: "Block",
  PULL: "Pull",
}

const EVENT_TYPE_COLORS: Record<PointEventType, string> = {
  GOAL: "text-green-400",
  ASSIST: "text-blue-400",
  TURNOVER: "text-red-400",
  BLOCK: "text-yellow-400",
  PULL: "text-white/50",
}

export default function GameManagePage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { gameId } = useParams<{ gameId: string }>()

  const [game, setGame] = useState<GameItem | null>(null)
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [gamePlayers, setGamePlayers] = useState<GamePlayerItem[]>([])
  const [points, setPoints] = useState<PointItem[]>([])
  const [pointEvents, setPointEvents] = useState<PointEventItem[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isLoading && !user) router.replace("/live/login")
  }, [user, isLoading, router])

  const loadData = useCallback(async () => {
    if (!user) return
    try {
      const [gameRes, playersRes, gamePlayersRes, pointsRes] = await Promise.all([
        fetch(`/api/games/${gameId}`),
        fetch("/api/players"),
        fetch(`/api/game-players?gameId=${gameId}`),
        fetch(`/api/points?gameId=${gameId}`),
      ])

      if (!gameRes.ok) { setError("Game not found"); return }

      const [gameData, playersData, gamePlayersData, pointsData] = await Promise.all([
        gameRes.json(),
        playersRes.json(),
        gamePlayersRes.json(),
        pointsRes.json(),
      ])

      setGame(gameData)
      setPlayers(Array.isArray(playersData) ? playersData : [])
      setGamePlayers(Array.isArray(gamePlayersData) ? gamePlayersData : [])
      setPoints(Array.isArray(pointsData) ? pointsData : [])

      if (Array.isArray(pointsData) && pointsData.length > 0) {
        const eventsRes = await fetch(`/api/point-events?gameId=${gameId}`)
        if (eventsRes.ok) {
          const eventsData = await eventsRes.json()
          setPointEvents(Array.isArray(eventsData) ? eventsData : [])
        }
      }
    } catch {
      setError("Failed to load game data")
    } finally {
      setDataLoading(false)
    }
  }, [user, gameId])

  useEffect(() => { loadData() }, [loadData])

  if (isLoading || !user) {
    return <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /></div>
  }

  if (dataLoading) {
    return <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /></div>
  }

  if (error || !game) {
    return (
      <div className="flex flex-col p-8 lg:px-16 gap-4">
        <button onClick={() => router.back()} className="text-white/40 hover:text-white/70 text-sm flex items-center gap-1 transition-colors w-fit">← Back</button>
        <p className="text-white/40 text-sm">{error || "Game not found."}</p>
      </div>
    )
  }

  const attendingPlayerIds = new Set(gamePlayers.map(gp => gp.playerId))
  const attendingPlayers = players.filter(p => attendingPlayerIds.has(p.id))
  const activePoint = points.find(p => p.status === "IN_PROGRESS") ?? null
  const completedPoints = points.filter(p => p.status === "COMPLETE").sort((a, b) => a.pointNumber - b.pointNumber)

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8 text-left max-w-4xl">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push("/live/manage?tab=games")}
          className="text-white/40 hover:text-white/70 text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Back to Games
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-black">vs {game.opponent}</h1>
              <Badge variant={STATUS_VARIANT[game.status]}>{game.status}</Badge>
              {game.result && (
                <span className={`text-sm font-bold ${game.result === "WIN" ? "text-green-400" : game.result === "LOSS" ? "text-red-400" : "text-yellow-400"}`}>
                  {game.result}
                </span>
              )}
            </div>
            {game.round && <p className="text-white/40 text-sm">{game.round}</p>}
            <p className="text-white/60 font-mono text-2xl mt-2">
              {game.scoreVoid} – {game.scoreOpponent}
            </p>
            <p className="text-white/30 text-xs mt-1">Cap: {game.cap} · VOID {game.voidReceivingFirst ? "received" : "pulled"} first</p>
          </div>
          <GameStatusControl
            game={game}
            completedCount={completedPoints.length}
            onUpdate={updated => setGame(updated)}
          />
        </div>
      </div>

      {/* Attending Roster */}
      <RosterSection
        players={players}
        gamePlayers={gamePlayers}
        gameId={gameId}
        onRosterChange={setGamePlayers}
      />

      {/* Broadcast */}
      <BroadcastSection game={game} />

      {/* Active Point */}
      {activePoint && (
        <ActivePointSection
          point={activePoint}
          attendingPlayers={attendingPlayers}
          events={pointEvents.filter(e => e.pointId === activePoint.id)}
          onEventAdded={e => setPointEvents(prev => [...prev, e])}
          onEventDeleted={id => setPointEvents(prev => prev.filter(e => e.id !== id))}
          onPointCompleted={updated => {
            setPoints(prev => prev.map(p => p.id === updated.id ? updated : p))
            loadData() // reload to get updated game score
          }}
        />
      )}

      {/* Add Point */}
      {!activePoint && game.status !== "FINAL" && (
        <AddPointSection
          game={game}
          attendingPlayers={attendingPlayers}
          nextPointNumber={points.length + 1}
          completedPoints={completedPoints}
          currentScoreVoid={game.scoreVoid}
          currentScoreOpponent={game.scoreOpponent}
          onPointCreated={point => {
            setPoints(prev => [...prev, point])
            setGame(g => g ? { ...g, status: "IN_PROGRESS" } : g)
          }}
        />
      )}

      {/* Completed Points Log */}
      {completedPoints.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Point Log</h2>
          <div className="flex flex-col gap-2">
            {completedPoints.map(point => (
              <CompletedPointRow
                key={point.id}
                point={point}
                players={players}
                attendingPlayers={attendingPlayers}
                events={pointEvents.filter(e => e.pointId === point.id)}
                onPointUpdated={updated => {
                  setPoints(prev => prev.map(p => p.id === updated.id ? updated : p))
                  loadData() // refresh game score
                }}
                onEventAdded={e => setPointEvents(prev => [...prev, e])}
                onEventDeleted={id => setPointEvents(prev => prev.filter(e => e.id !== id))}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// --- Game Status Control ---
function GameStatusControl({
  game,
  completedCount,
  onUpdate,
}: {
  game: GameItem
  completedCount: number
  onUpdate: (g: GameItem) => void
}) {
  const [saving, setSaving] = useState(false)

  async function setStatus(status: GameStatus) {
    setSaving(true)
    try {
      const res = await fetch(`/api/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (res.ok) onUpdate(await res.json())
    } finally {
      setSaving(false)
    }
  }

  if (game.status === "FINAL") return null
  return (
    <div className="flex items-center gap-2 shrink-0">
      {game.status === "IN_PROGRESS" && game.secondHalfStartCompletedCount === undefined && (
        <MarkHalfButton
          gameId={game.id}
          completedCount={completedCount}
          onMarked={onUpdate}
        />
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setStatus(game.status === "SCHEDULED" ? "IN_PROGRESS" : "FINAL")}
        disabled={saving}
      >
        {saving ? "…" : game.status === "SCHEDULED" ? "Start Game" : "End Game"}
      </Button>
    </div>
  )
}

// --- Roster Section ---
function RosterSection({
  players,
  gamePlayers,
  gameId,
  onRosterChange,
}: {
  players: PlayerItem[]
  gamePlayers: GamePlayerItem[]
  gameId: string
  onRosterChange: (gps: GamePlayerItem[]) => void
}) {
  // Optimistic UI state — updated immediately on every click
  const [pendingIds, setPendingIdsState] = useState<Set<string>>(
    () => new Set(gamePlayers.map(gp => gp.playerId))
  )
  const [saveStatus, setSaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle")

  // Refs so the debounced flush always sees the latest values without stale closures
  const pendingIdsRef = useRef<Set<string>>(new Set(gamePlayers.map(gp => gp.playerId)))
  const committedRef = useRef<GamePlayerItem[]>(gamePlayers)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function setPendingIds(next: Set<string>) {
    pendingIdsRef.current = next
    setPendingIdsState(next)
  }

  function togglePlayer(player: PlayerItem) {
    const next = new Set(pendingIdsRef.current)
    if (next.has(player.id)) next.delete(player.id)
    else next.add(player.id)
    setPendingIds(next)
    setSaveStatus("pending")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(flush, 800)
  }

  async function flush() {
    const latest = pendingIdsRef.current
    const committed = committedRef.current
    const committedIds = new Set(committed.map(gp => gp.playerId))

    const toAdd = [...latest].filter(id => !committedIds.has(id))
    const toRemove = committed.filter(gp => !latest.has(gp.playerId))

    if (toAdd.length === 0 && toRemove.length === 0) {
      setSaveStatus("idle")
      return
    }

    setSaveStatus("saving")
    try {
      const [added] = await Promise.all([
        Promise.all(
          toAdd.map(playerId =>
            fetch("/api/game-players", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ gameId, playerId }),
            }).then(r => r.json())
          )
        ),
        Promise.all(toRemove.map(gp => fetch(`/api/game-players/${gp.id}?gameId=${gameId}`, { method: "DELETE" }))),
      ])

      const newCommitted = [
        ...committed.filter(gp => latest.has(gp.playerId)),
        ...added,
      ]
      committedRef.current = newCommitted
      onRosterChange(newCommitted)
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus(prev => prev === "saved" ? "idle" : prev), 2000)
    } catch {
      setSaveStatus("error")
    }
  }

  const SAVE_STATUS_LABEL: Record<typeof saveStatus, string | null> = {
    idle: null,
    pending: "Unsaved changes…",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed",
  }
  const SAVE_STATUS_COLOR: Record<typeof saveStatus, string> = {
    idle: "",
    pending: "text-white/30",
    saving: "text-white/40",
    saved: "text-green-400/70",
    error: "text-red-400",
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-bold">Attending Roster</h2>
        <span className="text-white/30 font-normal text-sm">({pendingIds.size} players)</span>
        {SAVE_STATUS_LABEL[saveStatus] && (
          <span className={`text-xs ml-auto ${SAVE_STATUS_COLOR[saveStatus]}`}>
            {SAVE_STATUS_LABEL[saveStatus]}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {players.filter(p => p.is_active).map(player => {
          const attending = pendingIds.has(player.id)
          return (
            <button
              key={player.id}
              onClick={() => togglePlayer(player)}
              className={[
                "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors text-left",
                attending
                  ? "border-white/30 bg-white/10 text-white"
                  : "border-white/10 bg-transparent text-white/40 hover:text-white/60 hover:border-white/20",
              ].join(" ")}
            >
              <span className="font-mono text-xs w-6 text-right shrink-0 text-white/40">#{player.number}</span>
              <span className="truncate">{player.first_name} {player.last_name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// --- Active Point Section ---
function ActivePointSection({
  point,
  attendingPlayers,
  events,
  onEventAdded,
  onEventDeleted,
  onPointCompleted,
}: {
  point: PointItem
  attendingPlayers: PlayerItem[]
  events: PointEventItem[]
  onEventAdded: (e: PointEventItem) => void
  onEventDeleted: (id: string) => void
  onPointCompleted: (updated: PointItem) => void
}) {
  const [selectedPlayer, setSelectedPlayer] = useState("")
  const [selectedType, setSelectedType] = useState<PointEventType>("GOAL")
  const [addingEvent, setAddingEvent] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [eventError, setEventError] = useState("")

  const sortedEvents = [...events].sort((a, b) => a.sortOrder - b.sortOrder)
  const hasGoal = sortedEvents.some(e => e.eventType === "GOAL")

  function getPlayerName(id: string) {
    const p = attendingPlayers.find(p => p.id === id)
    return p ? `${p.first_name} ${p.last_name}` : "Unknown"
  }

  async function handleAddEvent(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPlayer) { setEventError("Select a player"); return }
    setAddingEvent(true)
    setEventError("")
    try {
      const res = await fetch("/api/point-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pointId: point.id,
          gameId: point.gameId,
          eventType: selectedType,
          playerId: selectedPlayer,
          sortOrder: sortedEvents.length + 1,
        }),
      })
      if (res.ok) {
        onEventAdded(await res.json())
        setSelectedPlayer("")
      } else {
        const data = await res.json()
        setEventError(data.error ?? "Failed to add event")
      }
    } finally {
      setAddingEvent(false)
    }
  }

  async function handleDeleteEvent(id: string) {
    await fetch(`/api/point-events/${id}?gameId=${point.gameId}`, { method: "DELETE" })
    onEventDeleted(id)
  }

  async function handleCompletePoint(voidScored: boolean) {
    // HOLD = O-line scores (expected); BREAK = D-line scores (unexpected)
    const outcome = voidScored
      ? (point.lineType === "O" ? "HOLD" : "BREAK")
      : (point.lineType === "O" ? "BREAK" : "HOLD")
    setCompleting(true)
    try {
      const res = await fetch(`/api/points/${point.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, status: "COMPLETE" }),
      })
      if (res.ok) onPointCompleted(await res.json())
    } finally {
      setCompleting(false)
    }
  }

  return (
    <section className="border border-white/20 rounded-xl p-5 bg-white/3">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Point {point.pointNumber} — In Progress</h2>
          <p className="text-white/40 text-sm mt-0.5">
            {point.lineType === "O" ? "O-line (VOID on offense)" : "D-line (VOID on defense)"}
            {point.playerIds.length > 0 && (
              <span className="ml-2">
                · {point.playerIds.map(id => attendingPlayers.find(p => p.id === id)).filter(Boolean).map(p => p!.first_name).join(", ")}
              </span>
            )}
          </p>
        </div>
        <div className="text-white/30 text-sm font-mono">{point.voidScoreBefore} – {point.opponentScoreBefore}</div>
      </div>

      {/* Event log */}
      {sortedEvents.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {sortedEvents.map((ev, i) => (
            <div key={ev.id} className="flex items-center gap-3 text-sm group">
              <span className="text-white/20 font-mono text-xs w-4 text-right">{i + 1}</span>
              <span className={`font-medium ${EVENT_TYPE_COLORS[ev.eventType]}`}>{EVENT_TYPE_LABELS[ev.eventType]}</span>
              <span className="text-white/60">{getPlayerName(ev.playerId)}</span>
              <button
                onClick={() => handleDeleteEvent(ev.id)}
                className="ml-auto text-white/20 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add event form */}
      <form onSubmit={handleAddEvent} className="flex items-end gap-2 mb-4">
        <select
          value={selectedType}
          onChange={e => setSelectedType(e.target.value as PointEventType)}
          className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none"
        >
          {(Object.keys(EVENT_TYPE_LABELS) as PointEventType[]).map(t => (
            <option key={t} value={t} className="bg-neutral-900">{EVENT_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select
          value={selectedPlayer}
          onChange={e => setSelectedPlayer(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none flex-1"
        >
          <option value="" className="bg-neutral-900">Select player…</option>
          {attendingPlayers.map(p => (
            <option key={p.id} value={p.id} className="bg-neutral-900">
              #{p.number} {p.first_name} {p.last_name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={addingEvent}>
          {addingEvent ? "…" : "Log"}
        </Button>
      </form>
      {eventError && <p className="text-red-400 text-xs mb-3">{eventError}</p>}

      {/* Complete point */}
      <div className="flex items-center gap-3 pt-4 border-t border-white/10">
        <span className="text-white/40 text-sm">Complete point:</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleCompletePoint(true)}
          disabled={completing || !hasGoal}
          className="text-green-400 border-green-400/30 hover:bg-green-400/10"
        >
          VOID Scored — {point.lineType === "O" ? "Hold" : "Break!"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleCompletePoint(false)}
          disabled={completing}
          className="text-red-400 border-red-400/30 hover:bg-red-400/10"
        >
          Opp Scored — {point.lineType === "O" ? "Break" : "Hold"}
        </Button>
        {!hasGoal && <span className="text-white/30 text-xs">Log a GOAL to credit a scorer</span>}
      </div>
    </section>
  )
}

// --- Mark Half Button ---
function MarkHalfButton({
  gameId,
  completedCount,
  onMarked,
}: {
  gameId: string
  completedCount: number
  onMarked: (updated: GameItem) => void
}) {
  const [saving, setSaving] = useState(false)

  async function handleMark() {
    setSaving(true)
    try {
      const res = await fetch(`/api/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondHalfStartCompletedCount: completedCount }),
      })
      if (res.ok) onMarked(await res.json())
    } finally {
      setSaving(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleMark} disabled={saving}
      className="text-white/50 border-white/20 hover:text-white">
      {saving ? "…" : "Mark Half"}
    </Button>
  )
}

// --- Add Point Section ---
function AddPointSection({
  game,
  attendingPlayers,
  nextPointNumber,
  completedPoints,
  currentScoreVoid,
  currentScoreOpponent,
  onPointCreated,
}: {
  game: GameItem
  attendingPlayers: PlayerItem[]
  nextPointNumber: number
  completedPoints: PointItem[]
  currentScoreVoid: number
  currentScoreOpponent: number
  onPointCreated: (p: PointItem) => void
}) {
  // Auto-derive line type: scoring team pulls next (D-line), receiving team is O-line
  const isSecondHalf = game.secondHalfStartCompletedCount !== undefined
  const receivingThisHalf = isSecondHalf ? !game.voidReceivingFirst : game.voidReceivingFirst
  const pointsThisHalf = isSecondHalf
    ? completedPoints.slice(game.secondHalfStartCompletedCount!)
    : completedPoints
  const lineType: "O" | "D" = (() => {
    if (pointsThisHalf.length === 0) {
      return receivingThisHalf ? "O" : "D"
    }
    const last = pointsThisHalf[pointsThisHalf.length - 1]
    const voidScoredLast =
      (last.outcome === "HOLD" && last.lineType === "O") ||
      (last.outcome === "BREAK" && last.lineType === "D")
    return voidScoredLast ? "D" : "O"
  })()

  const [open, setOpen] = useState(false)
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  function togglePlayer(id: string) {
    setSelectedPlayerIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: game.id,
          pointNumber: nextPointNumber,
          lineType,
          voidScoreBefore: currentScoreVoid,
          opponentScoreBefore: currentScoreOpponent,
          playerIds: selectedPlayerIds,
        }),
      })
      if (res.ok) {
        onPointCreated(await res.json())
        setOpen(false)
        setSelectedPlayerIds([])
      } else {
        const data = await res.json()
        setError(data.error ?? "Failed to create point")
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <div className="flex justify-center">
        <Button variant="outline" onClick={() => setOpen(true)}>
          + Start Point {nextPointNumber} ({lineType}-line)
        </Button>
      </div>
    )
  }

  return (
    <section className="border border-white/10 rounded-xl p-5">
      <h2 className="text-lg font-bold mb-1">Start Point {nextPointNumber}</h2>
      <p className="text-white/40 text-sm mb-4">
        {lineType === "O" ? "O-line — VOID received the pull" : "D-line — VOID is pulling"}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">

        {/* Player selection */}
        <div>
          <p className="text-sm text-white/50 mb-2">
            Select line ({selectedPlayerIds.length}/7 players)
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {attendingPlayers.map(player => {
              const selected = selectedPlayerIds.includes(player.id)
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => togglePlayer(player.id)}
                  className={[
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors text-left",
                    selected
                      ? "border-white/40 bg-white/10 text-white"
                      : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20",
                  ].join(" ")}
                >
                  <span className="font-mono text-xs w-5 text-right shrink-0 text-white/40">#{player.number}</span>
                  <span className="truncate">{player.first_name} {player.last_name}</span>
                </button>
              )
            })}
          </div>
          {attendingPlayers.length === 0 && (
            <p className="text-white/30 text-sm">No attending players — check in your roster first.</p>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Starting…" : "Start Point"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </section>
  )
}

// --- Completed Point Row ---
function CompletedPointRow({
  point,
  players,
  attendingPlayers,
  events,
  onPointUpdated,
  onEventAdded,
  onEventDeleted,
}: {
  point: PointItem
  players: PlayerItem[]
  attendingPlayers: PlayerItem[]
  events: PointEventItem[]
  onPointUpdated: (updated: PointItem) => void
  onEventAdded: (e: PointEventItem) => void
  onEventDeleted: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editOutcome, setEditOutcome] = useState<"HOLD" | "BREAK">(
    point.outcome === "HOLD" ? "HOLD" : "BREAK"
  )
  const [editLineType, setEditLineType] = useState<"O" | "D">(point.lineType)
  const [editPlayerIds, setEditPlayerIds] = useState<string[]>(point.playerIds)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  // Add-event form state
  const [selectedPlayer, setSelectedPlayer] = useState("")
  const [selectedType, setSelectedType] = useState<PointEventType>("GOAL")
  const [addingEvent, setAddingEvent] = useState(false)
  const [eventError, setEventError] = useState("")

  const sortedEvents = [...events].sort((a, b) => a.sortOrder - b.sortOrder)

  function getPlayerName(id: string) {
    const p = players.find(p => p.id === id)
    return p ? `${p.first_name} ${p.last_name}` : "Unknown"
  }

  const linePlayerNames = point.playerIds
    .map(id => players.find(p => p.id === id))
    .filter(Boolean)
    .map(p => p!.first_name)
    .join(", ")

  function toggleEditPlayer(id: string) {
    setEditPlayerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleSave() {
    setSaving(true)
    setSaveError("")
    try {
      const res = await fetch(`/api/points/${point.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: editOutcome,
          lineType: editLineType,
          playerIds: editPlayerIds,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setSaveError(data.error ?? "Failed to save")
        return
      }
      onPointUpdated(await res.json())
      setEditing(false)
    } catch {
      setSaveError("Failed to save")
    } finally {
      setSaving(false)
    }
  }

  function handleCancelEdit() {
    setEditOutcome(point.outcome === "HOLD" ? "HOLD" : "BREAK")
    setEditLineType(point.lineType)
    setEditPlayerIds(point.playerIds)
    setSaveError("")
    setEditing(false)
  }

  async function handleAddEvent(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPlayer) { setEventError("Select a player"); return }
    setAddingEvent(true)
    setEventError("")
    try {
      const res = await fetch("/api/point-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pointId: point.id,
          gameId: point.gameId,
          eventType: selectedType,
          playerId: selectedPlayer,
          sortOrder: sortedEvents.length + 1,
        }),
      })
      if (res.ok) {
        onEventAdded(await res.json())
        setSelectedPlayer("")
      } else {
        const data = await res.json()
        setEventError(data.error ?? "Failed to add event")
      }
    } finally {
      setAddingEvent(false)
    }
  }

  async function handleDeleteEvent(id: string) {
    await fetch(`/api/point-events/${id}?gameId=${point.gameId}`, { method: "DELETE" })
    onEventDeleted(id)
  }

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      {/* Summary row */}
      <div className="flex items-center gap-2 px-4 py-3 hover:bg-white/3 transition-colors">
        <button
          onClick={() => { setExpanded(e => !e); if (editing) setEditing(false) }}
          className="flex items-center gap-4 flex-1 text-left min-w-0"
        >
          <span className="text-white/30 font-mono text-xs w-6 text-right shrink-0">P{point.pointNumber}</span>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${
            (point.outcome === "HOLD" && point.lineType === "O") || (point.outcome === "BREAK" && point.lineType === "D")
              ? "bg-green-400/15 text-green-400"
              : "bg-red-400/15 text-red-400"
          }`}>
            {point.outcome}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${
            point.lineType === "O" ? "border-blue-400/30 text-blue-400/70" : "border-orange-400/30 text-orange-400/70"
          }`}>
            {point.lineType}-line
          </span>
          <span className="text-white/30 text-xs truncate flex-1">{linePlayerNames || "—"}</span>
          <span className="text-white/30 font-mono text-xs shrink-0">
            {point.voidScoreBefore} – {point.opponentScoreBefore}
          </span>
          <span className="text-white/20 text-xs shrink-0">{expanded ? "▲" : "▼"}</span>
        </button>
        <button
          onClick={() => { setEditing(true); setExpanded(true) }}
          className="text-white/30 hover:text-white text-xs transition-colors shrink-0 pl-2"
        >
          Edit
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-white/5 px-4 py-3">
          {editing ? (
            <div className="flex flex-col gap-4">
              {/* Outcome toggle */}
              <div>
                <p className="text-xs text-white/40 mb-2">Outcome</p>
                <div className="flex gap-2">
                  {(["HOLD", "BREAK"] as const).map(o => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setEditOutcome(o)}
                      className={[
                        "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
                        editOutcome === o
                          ? o === "HOLD"
                            ? "border-green-400/60 bg-green-400/15 text-green-400"
                            : "border-red-400/60 bg-red-400/15 text-red-400"
                          : "border-white/15 text-white/40 hover:text-white/60",
                      ].join(" ")}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              {/* Line type toggle */}
              <div>
                <p className="text-xs text-white/40 mb-2">Line type</p>
                <div className="flex gap-2">
                  {(["O", "D"] as const).map(lt => (
                    <button
                      key={lt}
                      type="button"
                      onClick={() => setEditLineType(lt)}
                      className={[
                        "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
                        editLineType === lt
                          ? "border-white/60 bg-white/10 text-white"
                          : "border-white/15 text-white/40 hover:text-white/60",
                      ].join(" ")}
                    >
                      {lt === "O" ? "O-line (offense)" : "D-line (defense)"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Player selection */}
              <div>
                <p className="text-xs text-white/40 mb-2">Line players ({editPlayerIds.length})</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {attendingPlayers.map(p => {
                    const selected = editPlayerIds.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleEditPlayer(p.id)}
                        className={[
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs transition-colors text-left",
                          selected
                            ? "border-white/30 bg-white/10 text-white"
                            : "border-white/10 text-white/40 hover:text-white/60",
                        ].join(" ")}
                      >
                        <span className="font-mono text-white/30 shrink-0">#{p.number}</span>
                        <span className="truncate">{p.first_name} {p.last_name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Event log with delete */}
              <div>
                <p className="text-xs text-white/40 mb-2">Events</p>
                {sortedEvents.length > 0 ? (
                  <div className="flex flex-col gap-1.5 mb-3">
                    {sortedEvents.map((ev, i) => (
                      <div key={ev.id} className="flex items-center gap-3 text-sm group">
                        <span className="text-white/20 font-mono text-xs w-4 text-right">{i + 1}</span>
                        <span className={`font-medium ${EVENT_TYPE_COLORS[ev.eventType]}`}>{EVENT_TYPE_LABELS[ev.eventType]}</span>
                        <span className="text-white/60">{getPlayerName(ev.playerId)}</span>
                        <button
                          onClick={() => handleDeleteEvent(ev.id)}
                          className="ml-auto text-white/20 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-white/20 text-xs mb-3">No events logged.</p>
                )}

                {/* Add event form */}
                <form onSubmit={handleAddEvent} className="flex items-center gap-2">
                  <select
                    value={selectedType}
                    onChange={e => setSelectedType(e.target.value as PointEventType)}
                    className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    {(Object.keys(EVENT_TYPE_LABELS) as PointEventType[]).map(t => (
                      <option key={t} value={t} className="bg-neutral-900">{EVENT_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <select
                    value={selectedPlayer}
                    onChange={e => setSelectedPlayer(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none flex-1"
                  >
                    <option value="" className="bg-neutral-900">Select player…</option>
                    {attendingPlayers.map(p => (
                      <option key={p.id} value={p.id} className="bg-neutral-900">
                        #{p.number} {p.first_name} {p.last_name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="outline" disabled={addingEvent} className="text-xs h-7 px-2">
                    {addingEvent ? "…" : "+ Log"}
                  </Button>
                </form>
                {eventError && <p className="text-red-400 text-xs mt-1">{eventError}</p>}
              </div>

              {/* Save / Cancel */}
              {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
              <div className="flex gap-2 pt-1 border-t border-white/10">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancelEdit}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              {sortedEvents.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {sortedEvents.map((ev, i) => (
                    <div key={ev.id} className="flex items-center gap-3 text-sm">
                      <span className="text-white/20 font-mono text-xs w-4 text-right">{i + 1}</span>
                      <span className={`font-medium ${EVENT_TYPE_COLORS[ev.eventType]}`}>{EVENT_TYPE_LABELS[ev.eventType]}</span>
                      <span className="text-white/60">{getPlayerName(ev.playerId)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-white/20 text-xs">No events logged.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// --- Broadcast Section ---
function BroadcastSection({ game }: { game: GameItem }) {
  const [state, setState] = useState<string>("IDLE")
  const [rtmpUrl, setRtmpUrl] = useState<string | null>(null)
  const [steps, setSteps] = useState<StepDef[]>([])
  const [acting, setActing] = useState(false)
  const [copied, setCopied] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/broadcast")
      if (!res.ok) return
      const data = await res.json()
      setState(data.state ?? "IDLE")
      if (data.rtmpUrl) setRtmpUrl(data.rtmpUrl)
      return data
    } catch {}
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  function startPolling() {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/broadcast")
        if (!res.ok) return
        const data = await res.json()
        setState(data.state ?? "IDLE")
        if (data.rtmpUrl) setRtmpUrl(data.rtmpUrl)
        if (data.job?.steps) setSteps(data.job.steps)
        if (data.job?.completedAt || data.job?.errorMessage) {
          stopPolling()
          setActing(false)
        }
      } catch {}
    }, 2000)
  }

  useEffect(() => () => stopPolling(), [])

  async function runAction(action: string, extraBody?: object) {
    setActing(true)
    setSteps([])
    startPolling()
    // Fire-and-forget — Lambda keeps running past HTTP timeout; client polls for progress
    fetch("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extraBody }),
    }).catch(() => {}) // 504 is expected for long operations; polling handles state
  }

  function copyUrl() {
    if (!rtmpUrl) return
    navigator.clipboard.writeText(rtmpUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isRunning = state === "RUNNING"
  const canStart = !acting && state === "IDLE" && game.status !== "FINAL"
  const canStop = !acting && (isRunning || state === "STARTING")

  const badgeStyle: React.CSSProperties = isRunning
    ? { background: "#16a34a", color: "#fff", border: "none" }
    : {}

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold">Broadcast</h2>
        <Badge
          variant={acting ? "secondary" : isRunning ? "default" : "outline"}
          style={!acting ? badgeStyle : {}}
          className="flex items-center gap-1"
        >
          {acting && (
            <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" />
          )}
          {acting ? "…" : state}
        </Badge>
      </div>

      {rtmpUrl && (
        <div className="flex flex-col gap-1">
          <p className="text-white/40 text-xs">RTMP Ingest URL (OBS → Settings → Stream)</p>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-white/80 bg-white/5 px-3 py-1.5 rounded border border-white/10 flex-1 truncate">
              {rtmpUrl}
            </code>
            <button
              onClick={copyUrl}
              className="text-xs text-white/40 hover:text-white/70 transition-colors shrink-0 px-2 py-1.5"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {steps.length > 0 && <StepProgress steps={steps} />}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => runAction("start", { gameId: game.id })}
          disabled={!canStart}
        >
          Start Broadcast
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => runAction("stop")}
          disabled={!canStop}
        >
          Stop Broadcast
        </Button>
        <button
          onClick={() => runAction("destroy-all")}
          disabled={acting}
          className="text-xs text-white/20 hover:text-red-400 transition-colors disabled:opacity-50 ml-2"
        >
          Destroy All
        </button>
      </div>
    </section>
  )
}
