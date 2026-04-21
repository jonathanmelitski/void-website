"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { GameStatus, GameResult } from "@/lib/aws/games"

type EventRow = { id: string; title: string; date: string }
type GameRow = {
  id: string
  eventId: string
  opponent: string
  round?: string
  scoreVoid: number
  scoreOpponent: number
  status: GameStatus
  result?: GameResult
  scheduledTime?: string
}

const STATUS_VARIANT: Record<GameStatus, "default" | "secondary" | "outline"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "secondary",
  FINAL: "default",
}

const RESULT_COLORS: Record<string, string> = {
  WIN: "text-green-400",
  LOSS: "text-red-400",
  TIE: "text-yellow-400",
}

export function GamesPanel() {
  const router = useRouter()
  const [events, setEvents] = useState<EventRow[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>("")
  const [games, setGames] = useState<GameRow[]>([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [loadingGames, setLoadingGames] = useState(false)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<GameRow[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const clearFnRef = useRef<() => void>(() => {})

  useEffect(() => {
    fetch("/api/events")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setEvents(data)
          if (data.length > 0) setSelectedEventId(data[0].id)
        } else {
          setError(data.error ?? "Failed to load events")
        }
      })
      .catch(() => setError("Failed to load events"))
      .finally(() => setLoadingEvents(false))
  }, [])

  useEffect(() => {
    if (!selectedEventId) return
    setLoadingGames(true)
    fetch(`/api/games?eventId=${selectedEventId}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setGames(data)
        else setError(data.error ?? "Failed to load games")
      })
      .catch(() => setError("Failed to load games"))
      .finally(() => setLoadingGames(false))
  }, [selectedEventId])

  function onGameCreated(game: GameRow) {
    setGames(prev => [...prev, game])
    setOpen(false)
  }

  async function handleDelete(targets: GameRow[], clearSelection: () => void) {
    setIsDeleting(true)
    try {
      await Promise.all(targets.map(g => fetch(`/api/games/${g.id}`, { method: "DELETE" })))
      const deletedIds = new Set(targets.map(g => g.id))
      setGames(prev => prev.filter(g => !deletedIds.has(g.id)))
      clearSelection()
    } catch {
      setError("Failed to delete game(s)")
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  const columns: ColumnDef<GameRow>[] = [
    {
      header: "Opponent",
      cell: row => (
        <span className="font-medium">
          {row.opponent}
          {row.round && <span className="text-white/40 font-normal ml-2 text-xs">{row.round}</span>}
        </span>
      ),
    },
    {
      header: "Score",
      cell: row => (
        row.status === "SCHEDULED"
          ? <span className="text-white/30 text-sm">Not started</span>
          : <span className="font-mono text-sm">
              <span className={row.result === "WIN" ? "text-green-400" : row.result === "LOSS" ? "text-red-400" : ""}>
                {row.scoreVoid}
              </span>
              {" – "}
              <span className={row.result === "LOSS" ? "text-green-400" : row.result === "WIN" ? "text-red-400" : ""}>
                {row.scoreOpponent}
              </span>
            </span>
      ),
    },
    {
      header: "Status",
      cell: row => (
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[row.status]} className="text-xs">{row.status}</Badge>
          {row.result && (
            <span className={`text-xs font-bold ${RESULT_COLORS[row.result] ?? ""}`}>{row.result}</span>
          )}
        </div>
      ),
    },
    {
      header: "Actions",
      cell: row => (
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/live/manage/games/${row.id}`)}
            className="text-white/50 hover:text-white text-sm underline underline-offset-2"
          >
            Manage →
          </button>
          <button
            onClick={() => setDeleteTarget([row])}
            className="text-red-400/60 hover:text-red-400 text-sm transition-colors"
          >
            Delete
          </button>
        </div>
      ),
    },
  ]

  const selectedEvent = events.find(e => e.id === selectedEventId)

  return (
    <div className="flex flex-col gap-6">
      {/* Event selector + create button */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Label className="text-white/50 text-sm shrink-0">Event</Label>
          {loadingEvents ? (
            <div className="h-9 w-48 rounded-md bg-white/5 animate-pulse" />
          ) : (
            <select
              value={selectedEventId}
              onChange={e => setSelectedEventId(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id} className="bg-neutral-900">
                  {ev.title} ({new Date(ev.date).getFullYear()})
                </option>
              ))}
            </select>
          )}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={!selectedEventId}>+ New Game</Button>
          </DialogTrigger>
          <DialogContent className="bg-black border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle>New Game</DialogTitle>
            </DialogHeader>
            <CreateGameForm
              eventId={selectedEventId}
              eventName={selectedEvent?.title ?? ""}
              onCreated={onGameCreated}
            />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <DataTable
        columns={columns}
        data={games}
        isLoading={loadingGames}
        getRowKey={g => g.id}
        emptyMessage={selectedEventId ? "No games logged for this event yet." : "Select an event to see games."}
        toolbar={(selectedRows, clearSelection) => {
          clearFnRef.current = clearSelection
          if (selectedRows.length === 0) return null
          return (
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/50">{selectedRows.length} selected</span>
              <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(selectedRows)}>
                Delete
              </Button>
            </div>
          )
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title={`Delete ${deleteTarget?.length === 1 ? "game" : `${deleteTarget?.length ?? 0} games`}?`}
        description="This will permanently delete the game(s). Points and events will remain in the database."
        confirmLabel="Delete"
        isLoading={isDeleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget, clearFnRef.current)}
      />
    </div>
  )
}

function CreateGameForm({
  eventId,
  eventName,
  onCreated,
}: {
  eventId: string
  eventName: string
  onCreated: (game: GameRow) => void
}) {
  const [opponent, setOpponent] = useState("")
  const [round, setRound] = useState("")
  const [cap, setCap] = useState("15")
  const [scheduledTime, setScheduledTime] = useState("")
  const [voidReceivingFirst, setVoidReceivingFirst] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!opponent.trim()) { setError("Opponent is required"); return }
    setIsSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          opponent: opponent.trim(),
          ...(round.trim() ? { round: round.trim() } : {}),
          cap: parseInt(cap) || 15,
          ...(scheduledTime ? { scheduledTime: new Date(scheduledTime).toISOString() } : {}),
          voidReceivingFirst,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Failed to create game")
        return
      }
      onCreated(await res.json())
    } catch {
      setError("Failed to create game")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="text-sm text-white/40">Event: <span className="text-white/70">{eventName}</span></div>

      <div className="flex flex-col gap-1.5">
        <Label>Opponent *</Label>
        <Input value={opponent} onChange={e => setOpponent(e.target.value)} placeholder="e.g. Dig" />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <Label>Round</Label>
          <Input value={round} onChange={e => setRound(e.target.value)} placeholder="e.g. Pool A, Quarters" />
        </div>
        <div className="flex flex-col gap-1.5 w-24">
          <Label>Cap</Label>
          <Input type="number" value={cap} onChange={e => setCap(e.target.value)} min={1} max={25} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Scheduled Time</Label>
        <Input type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
      </div>

      <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
        <input
          type="checkbox"
          checked={voidReceivingFirst}
          onChange={e => setVoidReceivingFirst(e.target.checked)}
          className="rounded"
        />
        VOID receives first pull
      </label>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating…" : "Create Game"}
      </Button>
    </form>
  )
}
