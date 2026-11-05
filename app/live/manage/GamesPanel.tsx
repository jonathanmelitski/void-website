"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/native-select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PrefetchLink } from "@/components/prefetch-link"
import { apiFetch } from "@/lib/api-fetch"
import { toast } from "@/components/ui/sonner"
import type { GameStatus, GameResult } from "@/lib/aws/games"
import { CONNECTION_HINT, deleteMany, friendlyError } from "./api-helpers"
import { FormFooter } from "./form-footer"

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

const STATUS_LABEL: Record<GameStatus, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  FINAL: "Final",
}

const RESULT_COLORS: Record<string, string> = {
  WIN: "text-success",
  LOSS: "text-destructive",
  TIE: "text-warning",
}

function GameScore({ row }: { row: GameRow }) {
  if (row.status === "SCHEDULED") return <span className="text-fg-muted text-sm">Not started</span>
  return (
    <span className="font-mono tabular-nums text-sm">
      <span className={row.result === "WIN" ? "text-success" : row.result === "LOSS" ? "text-destructive" : ""}>
        {row.scoreVoid}
      </span>
      {" – "}
      <span className={row.result === "LOSS" ? "text-success" : row.result === "WIN" ? "text-destructive" : ""}>
        {row.scoreOpponent}
      </span>
    </span>
  )
}

function GameStatusBadge({ row }: { row: GameRow }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Badge variant={STATUS_VARIANT[row.status]} className="text-xs">{STATUS_LABEL[row.status] ?? row.status}</Badge>
      {row.result && (
        <span className={`text-xs font-bold ${RESULT_COLORS[row.result] ?? ""}`}>{row.result}</span>
      )}
    </div>
  )
}

function ManageLink({ row, className }: { row: GameRow; className?: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className={className}>
      <PrefetchLink href={`/live/manage/games/${row.id}`} apiPrefetchUrls={[`/api/games/${row.id}`]}>
        Manage
      </PrefetchLink>
    </Button>
  )
}

export function GamesPanel() {
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
    apiFetch("/api/events")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setEvents(data)
          if (data.length > 0) setSelectedEventId(data[0].id)
        } else {
          setError("Couldn't load events. Reload to try again.")
        }
      })
      .catch(() => setError(`Couldn't load events. ${CONNECTION_HINT}`))
      .finally(() => setLoadingEvents(false))
  }, [])

  useEffect(() => {
    if (!selectedEventId) return
    setLoadingGames(true)
    apiFetch(`/api/games?eventId=${selectedEventId}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setGames(data)
        else setError("Couldn't load games. Reload to try again.")
      })
      .catch(() => setError(`Couldn't load games. ${CONNECTION_HINT}`))
      .finally(() => setLoadingGames(false))
  }, [selectedEventId])

  function onGameCreated(game: GameRow) {
    setGames(prev => [...prev, game])
    setOpen(false)
    toast.success("Game created")
  }

  async function handleDelete(targets: GameRow[]) {
    setIsDeleting(true)
    const deleted = await deleteMany(
      targets,
      g => apiFetch(`/api/games/${g.id}`, { method: "DELETE", waitForSession: true }),
      { one: "game", many: "games" },
    )
    const deletedIds = new Set(deleted.map(g => g.id))
    if (deletedIds.size > 0) setGames(prev => prev.filter(g => !deletedIds.has(g.id)))
    setIsDeleting(false)
    setDeleteTarget(null)
  }

  const columns: ColumnDef<GameRow>[] = [
    {
      header: "Opponent",
      cell: row => (
        <span className="font-medium">
          {row.opponent}
          {row.round && <span className="text-fg-muted font-normal ml-2 text-xs">{row.round}</span>}
        </span>
      ),
    },
    { header: "Score", cell: row => <GameScore row={row} /> },
    { header: "Status", cell: row => <GameStatusBadge row={row} /> },
    {
      header: "Actions",
      cell: row => (
        <div className="flex items-center gap-1">
          <ManageLink row={row} />
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget([row])}>
            Delete
          </Button>
        </div>
      ),
    },
  ]

  const selectedEvent = events.find(e => e.id === selectedEventId)

  return (
    <div className="flex flex-col gap-6 text-left">
      {/* Event selector + create button */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        {loadingEvents ? (
          <Skeleton className="h-10 w-full sm:w-64" />
        ) : (
          <Field label="Event" className="w-full sm:w-72">
            <NativeSelect
              value={selectedEventId}
              onChange={e => setSelectedEventId(e.target.value)}
              className="[&>select]:h-10 sm:[&>select]:h-9"
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} ({new Date(ev.date).getFullYear()})
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-10 sm:h-9" disabled={!selectedEventId}>New game</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New game</DialogTitle>
            </DialogHeader>
            <CreateGameForm
              eventId={selectedEventId}
              eventName={selectedEvent?.title ?? ""}
              onCreated={onGameCreated}
            />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <DataTable
        columns={columns}
        data={games}
        isLoading={loadingGames}
        getRowKey={g => g.id}
        emptyMessage={selectedEventId ? "No games for this event yet. Add one with New game." : "Pick an event to see its games."}
        mobileCard={row => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.opponent}</p>
                {row.round && <p className="truncate text-sm text-fg-muted">{row.round}</p>}
              </div>
              <GameStatusBadge row={row} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <GameScore row={row} />
              <div className="-mr-3 flex items-center">
                <ManageLink row={row} className="h-10" />
                <Button variant="ghost" size="sm" className="h-10 text-destructive hover:text-destructive" onClick={() => setDeleteTarget([row])}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
        toolbar={(selectedRows, clearSelection) => {
          clearFnRef.current = clearSelection
          if (selectedRows.length === 0) return null
          return (
            <div className="flex items-center gap-3">
              <span className="text-sm text-fg-muted">{selectedRows.length} selected</span>
              <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(selectedRows)}>
                Delete
              </Button>
            </div>
          )
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => { if (!open && !isDeleting) setDeleteTarget(null) }}
        title={`Delete ${deleteTarget?.length === 1 ? "game" : `${deleteTarget?.length ?? 0} games`}?`}
        description={
          deleteTarget?.length === 1
            ? <>Delete the game against <span className="font-medium text-foreground">{deleteTarget[0].opponent}</span>? Its points and events stay in the database.</>
            : "The games are deleted permanently. Their points and events stay in the database."
        }
        confirmLabel={deleteTarget && deleteTarget.length > 1 ? `Delete ${deleteTarget.length} games` : "Delete game"}
        isLoading={isDeleting}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
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
  const [opponentError, setOpponentError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!opponent.trim()) { setOpponentError("Enter the opponent's name."); return }
    setOpponentError("")
    setIsSubmitting(true)
    setError("")
    try {
      const res = await apiFetch("/api/games", {
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
        waitForSession: true,
      })
      if (!res.ok) {
        setError(await friendlyError(res, "Couldn't create the game. Try again."))
        return
      }
      onCreated(await res.json())
    } catch {
      setError(`Couldn't create the game. ${CONNECTION_HINT}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="text-sm text-fg-muted">Event: <span className="text-fg-secondary">{eventName}</span></div>

      <Field label="Opponent" error={opponentError}>
        <Input value={opponent} onChange={e => setOpponent(e.target.value)} placeholder="Team name" />
      </Field>

      <div className="flex gap-3">
        <Field label="Round" className="flex-1">
          <Input value={round} onChange={e => setRound(e.target.value)} placeholder="e.g. Pool A, Quarters" />
        </Field>
        <Field label="Cap" className="w-24">
          <Input type="number" value={cap} onChange={e => setCap(e.target.value)} min={1} max={25} />
        </Field>
      </div>

      <Field label="Scheduled time" hint="Optional">
        <Input type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
      </Field>

      <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={voidReceivingFirst}
          onChange={e => setVoidReceivingFirst(e.target.checked)}
          className="size-4 accent-foreground"
        />
        Void receives the first pull
      </label>

      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}

      <FormFooter submitLabel="Create game" isSubmitting={isSubmitting} />
    </form>
  )
}
