"use client"

import React, { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import { ChevronDown, ChevronLeft, Pencil, Undo2 } from "lucide-react"
import { useRequireAuth } from "@/hooks/use-require-auth"
import { apiFetch, errorMessage } from "@/lib/api-fetch"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/components/ui/sonner"
import { StepProgress } from "@/components/ui/step-progress"
import { LiveServerPanel } from "@/app/live/manage/LiveServerPanel"
import type { StepDef } from "@/lib/step-types"
import type { GameItem, GameStatus } from "@/lib/aws/games"
import type { PlayerItem } from "@/lib/aws/players"
import type { GamePlayerItem } from "@/lib/aws/game-players"
import type { PointItem } from "@/lib/aws/points"
import type { PointEventItem, PointEventType } from "@/lib/aws/point-events"
import { Spinner } from "@/components/ui/spinner"
import { ActionBar, ACTION_BAR_SPACE } from "@/components/scoring/action-bar"
import { EventList } from "@/components/scoring/event-list"
import { EventLogger } from "@/components/scoring/event-logger"
import { LinePicker, type LinePreset } from "@/components/scoring/line-picker"
import { RosterSection } from "@/components/scoring/roster-section"
import { ScoreBar } from "@/components/scoring/score-bar"
import {
  EVENT_TYPE_LABELS, SCORING_TOAST, SCORING_WRITE, eventDetail, makePlayerName, nextSortOrder, sortEvents,
  writeErrorText, type LogEventOpts,
} from "@/components/scoring/shared"

const STATUS_VARIANT: Record<GameStatus, "default" | "secondary" | "outline"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "secondary",
  FINAL: "default",
}

const STATUS_LABEL: Record<GameStatus, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  FINAL: "Final",
}

type Tab = "game" | "broadcast" | "server"

type ResourceStatus = {
  broadcast: { state: string; channelId: string | null } | null
  server: { status: string } | null
}

/** VOID scored the point: an O-line hold or a D-line break. */
function voidScored(p: Pick<PointItem, "outcome" | "lineType">) {
  return (p.outcome === "HOLD" && p.lineType === "O") || (p.outcome === "BREAK" && p.lineType === "D")
}

// Auto-derive line type: scoring team pulls next (D-line), receiving team is O-line
function nextLineType(game: GameItem, completedPoints: PointItem[]): "O" | "D" {
  const isSecondHalf = game.secondHalfStartCompletedCount !== undefined
  const receivingThisHalf = isSecondHalf ? !game.voidReceivingFirst : game.voidReceivingFirst
  const pointsThisHalf = isSecondHalf
    ? completedPoints.slice(game.secondHalfStartCompletedCount!)
    : completedPoints
  if (pointsThisHalf.length === 0) return receivingThisHalf ? "O" : "D"
  return voidScored(pointsThisHalf[pointsThisHalf.length - 1]) ? "D" : "O"
}

/** "Same as last point", "Last O-line", "Last D-line" from the points already played. */
function linePresets(completedPoints: PointItem[]): LinePreset[] {
  const played = completedPoints.filter(p => p.playerIds.length > 0)
  const last = (lt?: "O" | "D") => [...played].reverse().find(p => !lt || p.lineType === lt)?.playerIds ?? null
  return [
    { key: "same", label: "Same as last point", ids: last() },
    { key: "o", label: "Last O-line", ids: last("O") },
    { key: "d", label: "Last D-line", ids: last("D") },
  ]
}

export default function GameManagePage() {
  const { user, isLoading } = useRequireAuth()
  const router = useRouter()
  const { gameId } = useParams<{ gameId: string }>()

  const [game, setGame] = useState<GameItem | null>(null)
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [gamePlayers, setGamePlayers] = useState<GamePlayerItem[]>([])
  const [points, setPoints] = useState<PointItem[]>([])
  const [pointEvents, setPointEvents] = useState<PointEventItem[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<Tab>("game")
  const [resourceStatus, setResourceStatus] = useState<ResourceStatus>({ broadcast: null, server: null })
  const [savingReceiving, setSavingReceiving] = useState(false)
  const [editingOpponent, setEditingOpponent] = useState(false)
  const [opponentDraft, setOpponentDraft] = useState("")
  const [savingOpponent, setSavingOpponent] = useState(false)
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const fetchResourceStatus = useCallback(async () => {
    try {
      const [bRes, sRes] = await Promise.all([
        fetch("/api/broadcast"),
        fetch("/api/live-server"),
      ])
      const bData = bRes.ok ? await bRes.json() : null
      const sData = sRes.ok ? await sRes.json() : null
      setResourceStatus({
        broadcast: bData ? { state: bData.state ?? "IDLE", channelId: bData.channelId ?? null } : null,
        server: sData ? { status: sData.status ?? "offline" } : null,
      })
    } catch {}
  }, [])

  useEffect(() => {
    fetchResourceStatus()
    statusIntervalRef.current = setInterval(fetchResourceStatus, 10_000)
    return () => { if (statusIntervalRef.current) clearInterval(statusIntervalRef.current) }
  }, [fetchResourceStatus])

  async function patchGame(fields: Record<string, unknown>, failMsg: string): Promise<boolean> {
    if (!game) return false
    try {
      const res = await apiFetch(`/api/games/${game.id}`, {
        ...SCORING_WRITE,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      })
      if (!res.ok) { toast.error(await errorMessage(res, failMsg), SCORING_TOAST); return false }
      setGame(await res.json())
      return true
    } catch (err) {
      toast.error(writeErrorText(err, failMsg), SCORING_TOAST)
      return false
    }
  }

  async function handleSaveOpponent() {
    const trimmed = opponentDraft.trim()
    if (!trimmed || !game) return
    setSavingOpponent(true)
    if (await patchGame({ opponent: trimmed }, "Couldn't rename the opponent. Try again.")) setEditingOpponent(false)
    setSavingOpponent(false)
  }

  async function handleToggleReceiving() {
    if (!game || savingReceiving) return
    setSavingReceiving(true)
    await patchGame({ voidReceivingFirst: !game.voidReceivingFirst }, "Couldn't change who received first. Try again.")
    setSavingReceiving(false)
  }

  if (isLoading || !user) {
    return <div className="flex items-center justify-center min-h-[50dvh]"><Spinner size="md" /></div>
  }

  if (dataLoading) {
    return <div className="flex items-center justify-center min-h-[50dvh]"><Spinner size="md" /></div>
  }

  if (error || !game) {
    return (
      <div className="flex flex-col p-8 lg:px-16 gap-4">
        <button onClick={() => router.back()} className="text-fg-muted hover:text-foreground text-sm flex items-center gap-1 transition-colors w-fit min-h-10">← Back</button>
        <p className="text-fg-muted text-sm">{error || "Game not found."}</p>
      </div>
    )
  }

  const attendingPlayerIds = new Set(gamePlayers.map(gp => gp.playerId))
  const attendingPlayers = players.filter(p => attendingPlayerIds.has(p.id))
  const activePoint = points.find(p => p.status === "IN_PROGRESS") ?? null
  const completedPoints = points.filter(p => p.status === "COMPLETE").sort((a, b) => a.pointNumber - b.pointNumber)
  const upcomingLineType = nextLineType(game, completedPoints)
  const nextPointNumber = points.length + 1
  const showActionBar = activeTab === "game" && (!!activePoint || game.status !== "FINAL")

  const broadcastPill = (() => {
    const b = resourceStatus.broadcast
    if (!b || (!b.channelId && b.state === "IDLE")) return null
    if (b.state === "RUNNING" || b.state === "STARTING") return { label: "Live", variant: "destructive" as const }
    if (b.channelId) return { label: "Broadcast ready", variant: "warning" as const }
    return null
  })()

  const serverPill = (() => {
    const s = resourceStatus.server
    if (!s || s.status === "offline") return null
    if (s.status === "online") return { label: "Server on", variant: "success" as const }
    return { label: "Server starting", variant: "warning" as const }
  })()

  const scoreStatus = activePoint
    ? { label: `Point ${activePoint.pointNumber} · ${activePoint.lineType}-line`, tone: "live" as const }
    : game.status === "FINAL"
      ? { label: game.result ? `Final · ${game.result === "WIN" ? "Win" : game.result === "LOSS" ? "Loss" : "Tie"}` : "Final", tone: "final" as const }
      : { label: `Next: point ${nextPointNumber} · ${upcomingLineType}-line`, tone: "next" as const }

  return (
    <div className={cn("w-full max-w-3xl mx-auto px-4 sm:px-8 pt-3 sm:pt-6 flex flex-col gap-5", showActionBar ? ACTION_BAR_SPACE : "pb-10")}>
      {/* Header: rare, setup-type controls live up here, away from the thumb zone */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-3 h-10 text-fg-muted">
            <Link href="/live/manage?tab=games"><ChevronLeft /> Games</Link>
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {broadcastPill && <Badge variant={broadcastPill.variant}>{broadcastPill.label}</Badge>}
            {serverPill && <Badge variant={serverPill.variant}>{serverPill.label}</Badge>}
            <Badge variant={STATUS_VARIANT[game.status]}>{STATUS_LABEL[game.status]}</Badge>
          </div>
        </div>

        {editingOpponent ? (
          <form
            onSubmit={e => { e.preventDefault(); handleSaveOpponent() }}
            className="flex flex-wrap items-center gap-2"
          >
            <label htmlFor="opponent-name" className="text-3xl font-display leading-none tracking-wide text-fg-muted">vs</label>
            <input
              id="opponent-name"
              autoFocus
              value={opponentDraft}
              onChange={e => setOpponentDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setEditingOpponent(false) }}
              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-surface px-3 text-xl text-foreground"
            />
            <Button type="submit" size="sm" className="h-10" loading={savingOpponent}>Save</Button>
            <Button type="button" variant="ghost" size="sm" className="h-10" onClick={() => setEditingOpponent(false)}>Cancel</Button>
          </form>
        ) : (
          <div className="flex items-center gap-1">
            <h1 className="min-w-0 truncate text-3xl sm:text-4xl font-display leading-none tracking-wide">vs {game.opponent}</h1>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Rename opponent"
              onClick={() => { setOpponentDraft(game.opponent); setEditingOpponent(true) }}
              className="text-fg-muted"
            >
              <Pencil />
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          {game.round && <span>{game.round}</span>}
          <span>Cap {game.cap}</span>
          {game.status !== "FINAL" ? (
            <span className="inline-flex items-center gap-1">
              VOID {game.voidReceivingFirst ? "received" : "pulled"} first
              <Button
                variant="ghost"
                size="sm"
                className="h-10 px-2 text-fg-secondary"
                onClick={handleToggleReceiving}
                loading={savingReceiving}
                aria-label={`Change to: VOID ${game.voidReceivingFirst ? "pulled" : "received"} first`}
              >
                Change
              </Button>
            </span>
          ) : (
            <span>VOID {game.voidReceivingFirst ? "received" : "pulled"} first</span>
          )}
        </div>

        <GameStatusControl
          game={game}
          completedCount={completedPoints.length}
          onUpdate={updated => setGame(updated)}
        />
      </header>

      <ScoreBar scoreVoid={game.scoreVoid} scoreOpponent={game.scoreOpponent} opponent={game.opponent} status={scoreStatus} />

      {/* Tabs */}
      <div role="tablist" aria-label="Console sections" className="flex gap-1 bg-surface rounded-xl p-1">
        {(["game", "broadcast", "server"] as Tab[]).map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 min-h-10 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab
                ? "bg-surface-2 text-foreground"
                : "text-fg-muted hover:text-foreground"
            }`}
          >
            {tab === "broadcast" ? "Broadcast" : tab === "server" ? "Live server" : "Game"}
          </button>
        ))}
      </div>

      {/* Tab: Game — the live point (or the next line) first, then roster, then the log */}
      {activeTab === "game" && (
        <>
          {activePoint && (
            <ActivePointSection
              key={activePoint.id}
              point={activePoint}
              players={players}
              attendingPlayers={attendingPlayers}
              completedPoints={completedPoints}
              opponent={game.opponent}
              events={pointEvents.filter(e => e.pointId === activePoint.id)}
              onEventAdded={e => setPointEvents(prev => [...prev, e])}
              onEventDeleted={id => setPointEvents(prev => prev.filter(e => e.id !== id))}
              onPointCompleted={updated => {
                setPoints(prev => prev.map(p => p.id === updated.id ? updated : p))
                loadData()
              }}
              onLineUpdated={updated => setPoints(prev => prev.map(p => p.id === updated.id ? updated : p))}
            />
          )}

          {!activePoint && game.status !== "FINAL" && (
            <AddPointSection
              game={game}
              attendingPlayers={attendingPlayers}
              nextPointNumber={nextPointNumber}
              lineType={upcomingLineType}
              completedPoints={completedPoints}
              currentScoreVoid={game.scoreVoid}
              currentScoreOpponent={game.scoreOpponent}
              onPointCreated={point => {
                setPoints(prev => [...prev, point])
                setGame(g => g ? { ...g, status: "IN_PROGRESS" } : g)
              }}
            />
          )}

          <RosterSection
            players={players}
            gamePlayers={gamePlayers}
            gameId={gameId}
            onRosterChange={setGamePlayers}
            defaultOpen={points.length === 0 || gamePlayers.length === 0}
          />

          {completedPoints.length > 0 && (
            <section aria-labelledby="point-log-heading">
              <h2 id="point-log-heading" className="text-lg font-semibold mb-3">Point log</h2>
              <div className="flex flex-col gap-2">
                {completedPoints.map(point => (
                  <CompletedPointRow
                    key={point.id}
                    point={point}
                    players={players}
                    attendingPlayers={attendingPlayers}
                    opponent={game.opponent}
                    events={pointEvents.filter(e => e.pointId === point.id)}
                    onPointUpdated={updated => {
                      setPoints(prev => prev.map(p => p.id === updated.id ? updated : p))
                      loadData()
                    }}
                    onEventAdded={e => setPointEvents(prev => [...prev, e])}
                    onEventDeleted={id => setPointEvents(prev => prev.filter(e => e.id !== id))}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Tab: Broadcast */}
      {activeTab === "broadcast" && <BroadcastSection game={game} />}

      {/* Tab: Live Server */}
      {activeTab === "server" && <LiveServerPanel />}
    </div>
  )
}

// --- Game Status Control ---
// Start/End game change what the live server and broadcast do, so both ask first.
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
  const [statusError, setStatusError] = useState("")
  const [confirming, setConfirming] = useState<GameStatus | null>(null)

  const result = game.scoreVoid > game.scoreOpponent ? "WIN" : game.scoreVoid < game.scoreOpponent ? "LOSS" : "TIE"

  async function setStatus(status: GameStatus) {
    setSaving(true)
    setStatusError("")
    try {
      const body: Record<string, unknown> = { status }
      if (status === "FINAL") body.result = result
      const res = await apiFetch(`/api/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...SCORING_WRITE,
      })
      if (res.ok) { onUpdate(await res.json()); setConfirming(null) }
      else setStatusError(await errorMessage(res, "Couldn't update the game. Try again."))
    } catch (err) {
      setStatusError(writeErrorText(err, "Couldn't update the game. Try again."))
    } finally {
      setSaving(false)
    }
  }

  if (game.status === "FINAL") return null
  const next: GameStatus = game.status === "SCHEDULED" ? "IN_PROGRESS" : "FINAL"
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
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
          className="h-10"
          onClick={() => { setStatusError(""); setConfirming(next) }}
          disabled={saving}
        >
          {game.status === "SCHEDULED" ? "Start game" : "End game"}
        </Button>
      </div>
      {statusError && !confirming && <p role="alert" className="text-destructive text-xs">{statusError}</p>}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={o => { if (!o && !saving) setConfirming(null) }}
        title={confirming === "FINAL" ? `End the game at ${game.scoreVoid}–${game.scoreOpponent}?` : "Start the game?"}
        description={
          <>
            {confirming === "FINAL"
              ? `This records a ${result === "WIN" ? "win" : result === "LOSS" ? "loss" : "tie"} against ${game.opponent} and stops the live scoreboard and broadcast.`
              : `This turns on the live scoreboard and broadcast for the game against ${game.opponent}.`}
            {statusError && <span role="alert" className="mt-2 block text-destructive">{statusError}</span>}
          </>
        }
        confirmLabel={confirming === "FINAL" ? "End game" : "Start game"}
        destructive={confirming === "FINAL"}
        isLoading={saving}
        onConfirm={() => { if (confirming) setStatus(confirming) }}
      />
    </div>
  )
}

// --- Active Point Section ---
function ActivePointSection({
  point,
  players,
  attendingPlayers,
  completedPoints,
  opponent,
  events,
  onEventAdded,
  onEventDeleted,
  onPointCompleted,
  onLineUpdated,
}: {
  point: PointItem
  players: PlayerItem[]
  attendingPlayers: PlayerItem[]
  completedPoints: PointItem[]
  opponent: string
  events: PointEventItem[]
  onEventAdded: (e: PointEventItem) => void
  onEventDeleted: (id: string) => void
  onPointCompleted: (updated: PointItem) => void
  onLineUpdated: (updated: PointItem) => void
}) {
  const [addingEvent, setAddingEvent] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [eventError, setEventError] = useState("")
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [confirmOpp, setConfirmOpp] = useState(false)

  const [editingLine, setEditingLine] = useState(false)
  const [editPlayerIds, setEditPlayerIds] = useState<string[]>([])
  const [savingLine, setSavingLine] = useState(false)
  const [lineError, setLineError] = useState("")

  // Undo toasts outlive this render; they read the latest point/events through refs.
  const pointRef = useRef(point)
  const eventsRef = useRef(events)
  useEffect(() => { pointRef.current = point; eventsRef.current = events })

  const name = makePlayerName(players)
  const describe = (ev: PointEventItem) => eventDetail(ev, name, opponent)
  const sortedEvents = sortEvents(events)
  const hasGoal = sortedEvents.some(e => e.eventType === "GOAL")
  const lastEvent = sortedEvents[sortedEvents.length - 1]

  const byId = new Map(players.map(p => [p.id, p]))
  const onLine = point.playerIds.map(id => byId.get(id)).filter((p): p is PlayerItem => !!p)
  const linePlayerPool = point.playerIds.length > 0 ? onLine : attendingPlayers
  const benchPool = attendingPlayers.filter(p => !point.playerIds.includes(p.id))
  const editPool = [...attendingPlayers, ...onLine.filter(p => !attendingPlayers.some(a => a.id === p.id))]

  const playerIdsWithEvents = new Set(events.map(e => e.playerId))
  const removedWithEvents = point.playerIds.filter(
    id => !editPlayerIds.includes(id) && playerIdsWithEvents.has(id)
  )

  const scoredOutcome = point.lineType === "O" ? "Hold" : "Break"
  const concededOutcome = point.lineType === "O" ? "break" : "hold"

  async function handleAddEvent(eventType: PointEventType, opts: LogEventOpts): Promise<boolean> {
    setAddingEvent(true)
    setEventError("")
    try {
      const res = await apiFetch("/api/point-events", {
        ...SCORING_WRITE,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pointId: point.id,
          gameId: point.gameId,
          eventType,
          playerId: opts.playerId ?? "",
          ...(opts.playerInId ? { playerInId: opts.playerInId } : {}),
          ...(opts.team ? { team: opts.team } : {}),
          sortOrder: nextSortOrder(eventsRef.current),
        }),
      })
      if (!res.ok) {
        const msg = await errorMessage(res, "Couldn't add the event. Try again.")
        setEventError(msg)
        toast.error(msg, SCORING_TOAST)
        return false
      }
      const created: PointEventItem = await res.json()
      onEventAdded(created)
      eventsRef.current = [...eventsRef.current, created]
      if (eventType === "SUBSTITUTION" && opts.playerId && opts.playerInId) {
        const newIds = point.playerIds.filter(id => id !== opts.playerId).concat(opts.playerInId)
        try {
          const pr = await apiFetch(`/api/points/${point.id}`, {
            ...SCORING_WRITE,
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerIds: newIds }),
          })
          if (pr.ok) onLineUpdated(await pr.json())
          else toast.error("Sub logged, but the line didn't update. Use Edit line to fix it.", SCORING_TOAST)
        } catch {
          toast.error("Sub logged, but the line didn't update. Use Edit line to fix it.", SCORING_TOAST)
        }
      }
      const detail = eventDetail(created, name, opponent)
      toast(`${EVENT_TYPE_LABELS[created.eventType]}${detail ? ` · ${detail}` : ""}`, {
        ...SCORING_TOAST,
        duration: 5000,
        action: { label: "Undo", onClick: () => { removeEvent(created) } },
      })
      return true
    } catch (err) {
      const msg = writeErrorText(err, "Couldn't add the event. Try again.")
      setEventError(msg)
      toast.error(msg, SCORING_TOAST)
      return false
    } finally {
      setAddingEvent(false)
    }
  }

  // Removes an event once the server confirms. Removing a sub also swaps the line back.
  async function removeEvent(ev: PointEventItem) {
    if (removingIds.has(ev.id)) return
    setRemovingIds(s => new Set(s).add(ev.id))
    setEventError("")
    const label = EVENT_TYPE_LABELS[ev.eventType]
    try {
      const res = await apiFetch(`/api/point-events/${ev.id}?gameId=${ev.gameId}`, { method: "DELETE", ...SCORING_WRITE })
      // 404: already gone on the server, so dropping it locally is right
      if (!res.ok && res.status !== 404) {
        const msg = await errorMessage(res, `Couldn't remove the ${label.toLowerCase()}. Try again.`)
        setEventError(msg)
        toast.error(msg, SCORING_TOAST)
        return
      }
      onEventDeleted(ev.id)
      eventsRef.current = eventsRef.current.filter(e => e.id !== ev.id)
      toast(`Removed ${label.toLowerCase()}`, { ...SCORING_TOAST, duration: 2500 })

      const cur = pointRef.current.playerIds
      if (ev.eventType === "SUBSTITUTION" && ev.playerInId && cur.includes(ev.playerInId) && !cur.includes(ev.playerId)) {
        const restored = cur.map(id => (id === ev.playerInId ? ev.playerId : id))
        try {
          const pr = await apiFetch(`/api/points/${ev.pointId}`, {
            ...SCORING_WRITE,
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerIds: restored }),
          })
          if (pr.ok) onLineUpdated(await pr.json())
          else toast.error("Sub removed, but the line didn't change back. Use Edit line to fix it.", SCORING_TOAST)
        } catch {
          toast.error("Sub removed, but the line didn't change back. Use Edit line to fix it.", SCORING_TOAST)
        }
      }
    } catch (err) {
      const msg = writeErrorText(err, `Couldn't remove the ${label.toLowerCase()}. Try again.`)
      setEventError(msg)
      toast.error(msg, SCORING_TOAST)
    } finally {
      setRemovingIds(s => { const n = new Set(s); n.delete(ev.id); return n })
    }
  }

  async function handleCompletePoint(voidScoredPoint: boolean) {
    const outcome = voidScoredPoint
      ? (point.lineType === "O" ? "HOLD" : "BREAK")
      : (point.lineType === "O" ? "BREAK" : "HOLD")
    setCompleting(true)
    try {
      setEventError("")
      const res = await apiFetch(`/api/points/${point.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, status: "COMPLETE" }),
        ...SCORING_WRITE,
      })
      if (res.ok) {
        setConfirmOpp(false)
        onPointCompleted(await res.json())
        toast.success(`Point ${point.pointNumber}: ${voidScoredPoint ? "VOID" : opponent} scored`, SCORING_TOAST)
      } else {
        const msg = await errorMessage(res, "Couldn't finish the point. Try again.")
        setEventError(msg)
        toast.error(msg, SCORING_TOAST)
      }
    } catch (err) {
      const msg = writeErrorText(err, "Couldn't finish the point. Try again.")
      setEventError(msg)
      toast.error(msg, SCORING_TOAST)
    } finally {
      setCompleting(false)
    }
  }

  function openLineEditor() {
    setEditPlayerIds(point.playerIds)
    setLineError("")
    setEditingLine(true)
  }

  async function handleSaveLine() {
    setSavingLine(true)
    setLineError("")
    try {
      const res = await apiFetch(`/api/points/${point.id}`, {
        ...SCORING_WRITE,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerIds: editPlayerIds }),
      })
      if (!res.ok) { setLineError(await errorMessage(res, "Couldn't save the line. Try again.")); return }
      onLineUpdated(await res.json())
      setEditingLine(false)
    } catch (err) {
      setLineError(writeErrorText(err, "Couldn't save the line. Try again."))
    } finally {
      setSavingLine(false)
    }
  }

  return (
    <section aria-labelledby="active-point-heading" className="flex flex-col gap-4 rounded-xl border border-border-strong bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="active-point-heading" className="text-lg font-semibold">Point {point.pointNumber}</h2>
          <p className="text-sm text-fg-muted">
            {point.lineType === "O" ? "O-line · VOID on offense" : "D-line · VOID on defense"}
          </p>
        </div>
        {/* Rare and final: kept up here, away from the thumb zone, and confirmed */}
        <Button
          variant="destructive"
          size="sm"
          className="h-10 max-w-[50%] shrink-0"
          onClick={() => setConfirmOpp(true)}
          disabled={completing || editingLine}
        >
          <span className="truncate">{opponent} scored</span>
        </Button>
      </div>

      {editingLine ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Edit line</h3>
          <LinePicker
            pool={editPool}
            selected={editPlayerIds}
            onChange={setEditPlayerIds}
            presets={linePresets(completedPoints)}
            stickyClassName="top-[7.5rem] bg-card"
            autoFocus
            disabled={savingLine}
          />
          {removedWithEvents.length > 0 && (
            <p className="text-warning text-sm">
              {removedWithEvents.map(id => byId.get(id)?.first_name ?? "Unknown player").join(", ")}
              {" "}{removedWithEvents.length === 1 ? "has" : "have"} events logged on this point.
            </p>
          )}
          {lineError && <p role="alert" className="text-destructive text-sm">{lineError}</p>}
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 py-2 text-sm">
              <span className="text-fg-muted">On the line ({point.playerIds.length}): </span>
              <span className="text-fg-secondary">
                {onLine.length > 0 ? onLine.map(p => p.first_name).join(", ") : "nobody yet"}
              </span>
            </p>
            <Button variant="outline" size="sm" className="h-10 shrink-0" onClick={openLineEditor}>Edit line</Button>
          </div>

          {sortedEvents.length > 0 ? (
            <EventList
              events={sortedEvents}
              describe={describe}
              onRemove={removeEvent}
              pendingIds={removingIds}
              className="-my-1"
            />
          ) : (
            <p className="text-sm text-fg-muted">No events yet.</p>
          )}

          <EventLogger
            linePool={linePlayerPool}
            benchPool={benchPool}
            opponent={opponent}
            busy={addingEvent}
            onLog={handleAddEvent}
            onEditLine={openLineEditor}
          />

          {eventError && <p role="alert" className="text-destructive text-sm">{eventError}</p>}
        </>
      )}

      <ConfirmDialog
        open={confirmOpp}
        onOpenChange={o => { if (!completing) setConfirmOpp(o) }}
        title={`${opponent} scored?`}
        description={`Point ${point.pointNumber} ends as a ${concededOutcome}. The score goes to ${point.voidScoreBefore}–${point.opponentScoreBefore + 1}.`}
        confirmLabel={`${opponent} scored`}
        destructive={false}
        isLoading={completing}
        onConfirm={() => handleCompletePoint(false)}
      />

      {/* Thumb zone: the frequent actions for this point */}
      <ActionBar label="Point actions">
        {editingLine ? (
          <>
            <Button variant="outline" size="touch" onClick={() => { setEditingLine(false); setLineError("") }} disabled={savingLine}>
              Cancel
            </Button>
            <Button size="touch" className="flex-1" onClick={handleSaveLine} loading={savingLine}>
              Save line · <span className="font-mono tabular-nums">{editPlayerIds.length}/7</span>
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="touch"
              onClick={() => lastEvent && removeEvent(lastEvent)}
              disabled={!lastEvent || removingIds.size > 0 || addingEvent}
              aria-label={lastEvent ? `Undo last event: ${EVENT_TYPE_LABELS[lastEvent.eventType]} ${describe(lastEvent)}` : "Undo last event"}
            >
              <Undo2 /> Undo
            </Button>
            <Button
              size="touch"
              className="min-w-0 flex-1"
              onClick={() => handleCompletePoint(true)}
              disabled={!hasGoal || addingEvent}
              loading={completing && !confirmOpp}
            >
              <span className="truncate">{hasGoal ? `VOID scored · ${scoredOutcome}` : "Log the goal to finish"}</span>
            </Button>
          </>
        )}
      </ActionBar>
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
      const res = await apiFetch(`/api/games/${gameId}`, {
        ...SCORING_WRITE,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondHalfStartCompletedCount: completedCount }),
      })
      if (res.ok) onMarked(await res.json())
      else toast.error(await errorMessage(res, "Couldn't mark half. Try again."), SCORING_TOAST)
    } catch (err) {
      toast.error(writeErrorText(err, "Couldn't mark half. Try again."), SCORING_TOAST)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Button variant="outline" size="sm" className="h-10" onClick={handleMark} loading={saving}>
      Mark half
    </Button>
  )
}

// --- Add Point Section ---
// Between points the console is the line picker: the next point's 7 are the only thing to do.
function AddPointSection({
  game,
  attendingPlayers,
  nextPointNumber,
  lineType,
  completedPoints,
  currentScoreVoid,
  currentScoreOpponent,
  onPointCreated,
}: {
  game: GameItem
  attendingPlayers: PlayerItem[]
  nextPointNumber: number
  lineType: "O" | "D"
  completedPoints: PointItem[]
  currentScoreVoid: number
  currentScoreOpponent: number
  onPointCreated: (p: PointItem) => void
}) {
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit() {
    if (selectedPlayerIds.length === 0) return
    setSubmitting(true)
    setError("")
    try {
      const res = await apiFetch("/api/points", {
        ...SCORING_WRITE,
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
        setSelectedPlayerIds([])
      } else {
        const msg = await errorMessage(res, "Couldn't start the point. Try again.")
        setError(msg)
        toast.error(msg, SCORING_TOAST)
      }
    } catch (err) {
      const msg = writeErrorText(err, "Couldn't start the point. Try again.")
      setError(msg)
      toast.error(msg, SCORING_TOAST)
    } finally {
      setSubmitting(false)
    }
  }

  const count = selectedPlayerIds.length
  return (
    <section aria-labelledby="next-line-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="next-line-heading" className="text-lg font-semibold">Point {nextPointNumber} line</h2>
        <p className="text-sm text-fg-muted">
          {lineType === "O" ? "O-line · VOID receives the pull" : "D-line · VOID pulls"}
        </p>
      </div>
      <LinePicker
        pool={attendingPlayers}
        selected={selectedPlayerIds}
        onChange={setSelectedPlayerIds}
        presets={linePresets(completedPoints)}
        autoFocus
        captureTyping
        disabled={submitting}
        emptyPool={
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-fg-muted">
            Nobody is marked as here yet. Tap who came in the roster below, then pick the line.
          </p>
        }
      />
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}

      <ActionBar label="Start point">
        <Button
          size="touch"
          variant={count === 7 ? "default" : "outline"}
          className={cn("flex-1", count > 0 && count !== 7 && "border-warning text-warning")}
          onClick={handleSubmit}
          disabled={count === 0}
          loading={submitting}
        >
          {count === 0 ? `Pick the line for point ${nextPointNumber}` : (
            <>Start point {nextPointNumber} · <span className="font-mono tabular-nums">{count}/7</span></>
          )}
        </Button>
      </ActionBar>
    </section>
  )
}

// --- Completed Point Row ---
function CompletedPointRow({
  point,
  players,
  attendingPlayers,
  opponent,
  events,
  onPointUpdated,
  onEventAdded,
  onEventDeleted,
}: {
  point: PointItem
  players: PlayerItem[]
  attendingPlayers: PlayerItem[]
  opponent: string
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
  // Removals wait for Save (one batch request), so Cancel really cancels them
  const [stagedDeletes, setStagedDeletes] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  const [addingEvent, setAddingEvent] = useState(false)
  const [eventError, setEventError] = useState("")

  const name = makePlayerName(players)
  const describe = (ev: PointEventItem) => eventDetail(ev, name, opponent)
  const sortedEvents = sortEvents(events)
  const byId = new Map(players.map(p => [p.id, p]))
  const onLine = point.playerIds.map(id => byId.get(id)).filter((p): p is PlayerItem => !!p)
  const editPool = [...attendingPlayers, ...onLine.filter(p => !attendingPlayers.some(a => a.id === p.id))]

  const eventPlayerIds = new Set(events.filter(e => !stagedDeletes.has(e.id)).map(e => e.playerId))
  const removedWithEvents = point.playerIds.filter(
    id => !editPlayerIds.includes(id) && eventPlayerIds.has(id)
  )

  const linePlayerPool = point.playerIds.length > 0 ? onLine : attendingPlayers
  const benchPool = attendingPlayers.filter(p => !point.playerIds.includes(p.id))

  const linePlayerNames = onLine.map(p => p.first_name).join(", ")
  const vScored = voidScored(point)
  const outcomeLabel = point.outcome === "HOLD" ? "Hold" : point.outcome === "BREAK" ? "Break" : point.outcome

  const lineChanged =
    editPlayerIds.length !== point.playerIds.length || editPlayerIds.some(id => !point.playerIds.includes(id))
  const pointChanged = editOutcome !== point.outcome || editLineType !== point.lineType || lineChanged

  async function handleSave() {
    setSaving(true)
    setSaveError("")
    try {
      if (stagedDeletes.size > 0) {
        const ids = [...stagedDeletes]
        const res = await apiFetch("/api/point-events/batch", {
          ...SCORING_WRITE,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pointId: point.id, deletes: ids }),
        })
        if (!res.ok) {
          setSaveError(await errorMessage(res, "Couldn't remove the events. Try again."))
          return
        }
        ids.forEach(onEventDeleted)
        setStagedDeletes(new Set())
      }
      if (pointChanged) {
        const res = await apiFetch(`/api/points/${point.id}`, {
          ...SCORING_WRITE,
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outcome: editOutcome,
            lineType: editLineType,
            playerIds: editPlayerIds,
          }),
        })
        if (!res.ok) {
          setSaveError(await errorMessage(res, "Couldn't save the point. Try again."))
          return
        }
        onPointUpdated(await res.json())
      }
      setEditing(false)
      toast.success(`Point ${point.pointNumber} saved`, SCORING_TOAST)
    } catch (err) {
      setSaveError(writeErrorText(err, "Couldn't save the point. Try again."))
    } finally {
      setSaving(false)
    }
  }

  function handleCancelEdit() {
    setEditOutcome(point.outcome === "HOLD" ? "HOLD" : "BREAK")
    setEditLineType(point.lineType)
    setEditPlayerIds(point.playerIds)
    setStagedDeletes(new Set())
    setSaveError("")
    setEditing(false)
  }

  async function handleAddEvent(eventType: PointEventType, opts: LogEventOpts): Promise<boolean> {
    setAddingEvent(true)
    setEventError("")
    try {
      const res = await apiFetch("/api/point-events", {
        ...SCORING_WRITE,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pointId: point.id,
          gameId: point.gameId,
          eventType,
          playerId: opts.playerId ?? "",
          ...(opts.playerInId ? { playerInId: opts.playerInId } : {}),
          ...(opts.team ? { team: opts.team } : {}),
          sortOrder: nextSortOrder(events),
        }),
      })
      if (!res.ok) {
        setEventError(await errorMessage(res, "Couldn't add the event. Try again."))
        return false
      }
      onEventAdded(await res.json())
      if (eventType === "SUBSTITUTION" && opts.playerId && opts.playerInId) {
        const newIds = point.playerIds.filter(id => id !== opts.playerId).concat(opts.playerInId)
        setEditPlayerIds(newIds)
        const pr = await apiFetch(`/api/points/${point.id}`, {
          ...SCORING_WRITE,
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerIds: newIds }),
        })
        if (pr.ok) onPointUpdated(await pr.json())
        else setEventError("Sub logged, but the line didn't update. Fix it in Line players and save.")
      }
      return true
    } catch (err) {
      setEventError(writeErrorText(err, "Couldn't add the event. Try again."))
      return false
    } finally {
      setAddingEvent(false)
    }
  }

  function toggleStaged(ev: PointEventItem) {
    setStagedDeletes(s => {
      const n = new Set(s)
      if (n.has(ev.id)) n.delete(ev.id)
      else n.add(ev.id)
      return n
    })
  }

  const toggleBtn = (active: boolean) => cn(
    "h-10 px-3 rounded-md border text-sm font-medium transition-colors",
    active ? "border-border-strong bg-surface-3 text-foreground" : "border-border text-fg-muted hover:text-foreground"
  )

  return (
    <div className="border border-border rounded-xl">
      {/* Summary row */}
      <div className="flex items-center gap-1 pl-3 pr-1">
        <button
          onClick={() => { setExpanded(e => !e); if (editing) handleCancelEdit() }}
          aria-expanded={expanded}
          className="flex min-h-12 items-center gap-3 flex-1 text-left min-w-0 py-2"
        >
          <span className="text-fg-muted font-mono tabular-nums text-xs w-7 shrink-0">P{point.pointNumber}</span>
          <span className={cn(
            "text-xs font-medium px-1.5 py-0.5 rounded-md shrink-0 max-w-[9rem] truncate",
            vScored ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
          )}>
            {vScored ? "VOID" : opponent} · {outcomeLabel}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded-md border border-border text-fg-secondary shrink-0">
            {point.lineType}
          </span>
          <span className="text-fg-muted text-xs truncate flex-1 hidden sm:block">{linePlayerNames || "No line recorded"}</span>
          <span className="ml-auto text-fg-muted font-mono tabular-nums text-xs shrink-0">
            {point.voidScoreBefore}–{point.opponentScoreBefore}
          </span>
          <ChevronDown aria-hidden className={cn("size-4 text-fg-muted shrink-0 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
        </button>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={() => { setEditing(true); setExpanded(true) }}
            aria-label={`Edit point ${point.pointNumber}`}
          >
            Edit
          </Button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-3 sm:px-4 py-3">
          {editing ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-x-6 gap-y-4">
                <fieldset>
                  <legend className="text-xs font-medium text-fg-muted mb-2">Outcome</legend>
                  <div className="flex gap-2">
                    {(["HOLD", "BREAK"] as const).map(o => (
                      <button key={o} type="button" aria-pressed={editOutcome === o} onClick={() => setEditOutcome(o)} className={toggleBtn(editOutcome === o)}>
                        {o === "HOLD" ? "Hold" : "Break"}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-xs font-medium text-fg-muted mb-2">Line type</legend>
                  <div className="flex gap-2">
                    {(["O", "D"] as const).map(lt => (
                      <button key={lt} type="button" aria-pressed={editLineType === lt} onClick={() => setEditLineType(lt)} className={toggleBtn(editLineType === lt)}>
                        {lt === "O" ? "O-line" : "D-line"}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>

              {/* Events: removals are staged until Save */}
              <div>
                <p className="text-xs font-medium text-fg-muted mb-1">Events</p>
                {sortedEvents.length > 0 ? (
                  <EventList
                    events={sortedEvents}
                    describe={describe}
                    onRemove={toggleStaged}
                    onRestore={toggleStaged}
                    stagedIds={stagedDeletes}
                  />
                ) : (
                  <p className="text-fg-muted text-sm">No events logged.</p>
                )}
                {stagedDeletes.size > 0 && (
                  <p className="text-xs text-warning mt-1">
                    {stagedDeletes.size === 1 ? "1 event" : `${stagedDeletes.size} events`} will be removed when you save.
                  </p>
                )}
              </div>

              <EventLogger
                title="Add event"
                linePool={linePlayerPool}
                benchPool={benchPool}
                opponent={opponent}
                busy={addingEvent}
                onLog={handleAddEvent}
              />
              {eventError && <p role="alert" className="text-destructive text-sm">{eventError}</p>}

              <div>
                <p className="text-xs font-medium text-fg-muted mb-1">Line players</p>
                <LinePicker
                  pool={editPool}
                  selected={editPlayerIds}
                  onChange={setEditPlayerIds}
                  stickyClassName="top-[7.5rem] bg-background"
                  disabled={saving}
                />
                {removedWithEvents.length > 0 && (
                  <p className="text-warning text-sm mt-2">
                    {removedWithEvents.map(id => byId.get(id)?.first_name ?? "Unknown player").join(", ")}
                    {" "}{removedWithEvents.length === 1 ? "has" : "have"} events logged on this point.
                  </p>
                )}
              </div>

              {/* Save / Cancel */}
              {saveError && <p role="alert" className="text-destructive text-sm">{saveError}</p>}
              <div className="flex gap-2 pt-3 border-t border-border">
                <Button className="h-10" onClick={handleSave} loading={saving}>
                  Save changes
                </Button>
                <Button className="h-10" variant="ghost" onClick={handleCancelEdit} disabled={saving}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-fg-muted mb-2 sm:hidden">{linePlayerNames || "No line recorded"}</p>
              {sortedEvents.length > 0 ? (
                <EventList events={sortedEvents} describe={describe} />
              ) : (
                <p className="text-fg-muted text-sm">No events logged.</p>
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
  const [channelId, setChannelId] = useState<string | null>(null)
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
      setChannelId(data.channelId ?? null)
      if (data.rtmpUrl) setRtmpUrl(data.rtmpUrl)
      return data
    } catch {}
  }, [])

  useEffect(() => {
    fetchStatus().then(data => {
      if (data?.job?.steps?.length) setSteps(data.job.steps)
      if (data?.job && !data.job.completedAt && !data.job.errorMessage) {
        setActing(true)
        startPolling()
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        setChannelId(data.channelId ?? null)
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
    fetch("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extraBody }),
    }).catch(() => {})
  }

  function copyUrl() {
    if (!rtmpUrl) return
    navigator.clipboard.writeText(rtmpUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isPrepared = !!channelId && state === "IDLE"
  const isRunning  = state === "RUNNING" || state === "STARTING"
  const canPrepare = !acting && !channelId && game.status !== "FINAL"
  const canGoLive  = !acting && isPrepared && game.status !== "FINAL"
  const canStop    = !acting && (isRunning || isPrepared)

  const stateLabel = acting ? "…" : isRunning ? "LIVE" : isPrepared ? "Ready" : "Idle"
  const badgeVariant = isRunning ? "default" : acting ? "secondary" : "outline"
  const badgeStyle: React.CSSProperties = isRunning ? { background: "#dc2626", color: "#fff", border: "none" } : {}

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold">Broadcast</h2>
        <Badge variant={badgeVariant} style={badgeStyle} className="flex items-center gap-1.5">
          {acting && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" />}
          {stateLabel}
        </Badge>
      </div>

      {/* Phase callout when prepared but not live */}
      {isPrepared && !isRunning && !acting && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning/80">
          Resources are ready. Configure OBS with the RTMP URL below, start streaming, then click <strong>Go Live</strong>.
        </div>
      )}

      {rtmpUrl && (
        <div className="flex flex-col gap-1.5">
          <p className="text-fg-muted text-xs">RTMP Ingest URL — OBS → Settings → Stream → Custom</p>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-foreground bg-surface px-3 py-2 rounded-md border border-border flex-1 truncate">
              {rtmpUrl}
            </code>
            <button
              onClick={copyUrl}
              className="text-xs text-fg-muted hover:text-foreground transition-colors shrink-0 px-2 py-2"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {steps.length > 0 && <StepProgress steps={steps} />}

      <div className="flex flex-wrap items-center gap-2">
        {/* Phase 1: Prepare */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => runAction("prepare", { gameId: game.id })}
          disabled={!canPrepare}
        >
          Prepare
        </Button>

        {/* Phase 2: Go Live */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => runAction("go-live")}
          disabled={!canGoLive}
          className={canGoLive ? "border-success/50 text-success hover:bg-success/10" : ""}
        >
          Go Live
        </Button>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => runAction("stop")}
          disabled={!canStop}
        >
          Stop
        </Button>

        <button
          onClick={() => runAction("destroy-all")}
          disabled={acting}
          className="text-xs text-fg-faint hover:text-destructive transition-colors disabled:opacity-50 ml-1"
        >
          Destroy All
        </button>
      </div>
    </section>
  )
}
