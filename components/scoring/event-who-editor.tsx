"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { PlayerItem } from "@/lib/aws/players"
import type { PointEventItem } from "@/lib/aws/point-events"
import { OPP_TURNOVER_TYPES, TURNOVER_TYPES, TURNOVER_TYPE_LABELS, type PullResult, type TurnoverType } from "@/lib/point-event-meta"
import { PlayerTile } from "./player-tile"
import { byDisplayName } from "./shared"

export type EventWhoChange = { playerId?: string; playerInId?: string; team?: "VOID" | "OPP"; pullResult?: PullResult; turnoverType?: TurnoverType }

/** Events that only mark a moment have nobody to change. */
export function canEditWho(ev: PointEventItem) {
  return ev.eventType !== "PULL_FINISHED" && ev.eventType !== "TAP_IN"
}

const chip = (on: boolean) => cn(
  "h-10 rounded-full border px-3 text-sm transition-colors touch-manipulation disabled:opacity-50",
  on ? "border-foreground bg-foreground text-background" : "border-border text-fg-secondary hover:bg-surface-3",
)

/**
 * Change who did an event, in place. Its time, order and type stay as logged, so film sync holds.
 * Single-player events save on the tap; pulls, subs and timeouts have their own small forms.
 */
export function EventWhoEditor({
  event,
  linePool,
  benchPool,
  allPlayers,
  opponent,
  busy,
  onSave,
  onCancel,
}: {
  event: PointEventItem
  linePool: PlayerItem[]
  benchPool: PlayerItem[]
  /** For names of players no longer on the line or roster. */
  allPlayers: PlayerItem[]
  opponent: string
  busy: boolean
  onSave: (change: EventWhoChange) => Promise<boolean>
  onCancel: () => void
}) {
  const byId = new Map(allPlayers.map(p => [p.id, p]))
  // Keep the current pick visible even if they've since left the line
  const withCurrent = (pool: PlayerItem[], id?: string) => {
    const cur = id ? byId.get(id) : undefined
    return [...pool, ...(cur && !pool.some(p => p.id === cur.id) ? [cur] : [])].sort(byDisplayName)
  }

  const [team, setTeam] = useState<"VOID" | "OPP">(event.team ?? "VOID")
  const [playerId, setPlayerId] = useState(event.playerId)
  const [playerInId, setPlayerInId] = useState(event.playerInId)
  const [pullResult, setPullResult] = useState<PullResult | undefined>(event.pullResult)
  const [turnoverType, setTurnoverType] = useState<TurnoverType | undefined>(event.turnoverType)

  const footer = (save?: () => void, canSave = true) => (
    <div className="flex gap-2">
      {save && <Button size="sm" className="h-10" onClick={save} disabled={!canSave} loading={busy}>Save</Button>}
      <Button size="sm" variant="ghost" className="h-10" onClick={onCancel} disabled={busy}>Cancel</Button>
    </div>
  )

  let body: React.ReactNode
  if (event.eventType === "TIMEOUT") {
    body = (
      <>
        <p className="text-xs text-fg-muted">Who called it?</p>
        <div className="grid grid-cols-2 gap-2">
          {(["VOID", "OPP"] as const).map(t => (
            <Button key={t} variant={event.team === t ? "default" : "outline"} className="h-12 min-w-0" disabled={busy} onClick={() => onSave({ team: t })}>
              <span className="truncate">{t === "VOID" ? "VOID" : opponent}</span>
            </Button>
          ))}
        </div>
        {footer()}
      </>
    )
  } else if (event.eventType === "PULL") {
    body = (
      <>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who pulled">
          {(["VOID", "OPP"] as const).map(t => (
            <button key={t} type="button" aria-pressed={team === t} className={chip(team === t)} onClick={() => setTeam(t)} disabled={busy}>
              {t === "VOID" ? "Our pull" : `${opponent} pull`}
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
          {(["IN", "OUT"] as const).map(r => (
            <button key={r} type="button" aria-pressed={pullResult === r} className={chip(pullResult === r)} onClick={() => setPullResult(r)} disabled={busy}>
              {r === "IN" ? "In" : "Out"}
            </button>
          ))}
        </div>
        {team === "VOID" && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pulled by">
            {withCurrent(linePool, event.playerId).map(p => (
              <button key={p.id} type="button" aria-pressed={playerId === p.id} className={chip(playerId === p.id)} onClick={() => setPlayerId(p.id)} disabled={busy}>
                {p.first_name}
              </button>
            ))}
          </div>
        )}
        {footer(
          () => onSave({ team, ...(team === "VOID" ? { playerId } : {}), ...(pullResult ? { pullResult } : {}) }),
          team === "OPP" || !!playerId,
        )}
      </>
    )
  } else if (event.eventType === "OPP_TURNOVER") {
    body = (
      <>
        <p className="text-xs text-fg-muted">How did {opponent} turn it?</p>
        <div className="grid grid-cols-2 gap-2">
          {OPP_TURNOVER_TYPES.map(t => (
            <Button key={t} variant={event.turnoverType === t ? "default" : "outline"} className="h-12" disabled={busy} onClick={() => onSave({ turnoverType: t })}>
              {TURNOVER_TYPE_LABELS[t]}
            </Button>
          ))}
        </div>
        {footer()}
      </>
    )
  } else if (event.eventType === "TURNOVER") {
    body = (
      <>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Turnover type">
          {TURNOVER_TYPES.map(t => (
            <button key={t} type="button" aria-pressed={turnoverType === t} className={chip(turnoverType === t)} onClick={() => setTurnoverType(t)} disabled={busy}>
              {TURNOVER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who">
          {withCurrent(linePool, event.playerId).map(p => (
            <button key={p.id} type="button" aria-pressed={playerId === p.id} className={chip(playerId === p.id)} onClick={() => setPlayerId(p.id)} disabled={busy}>
              {p.first_name}
            </button>
          ))}
        </div>
        {footer(() => onSave({ playerId, ...(turnoverType ? { turnoverType } : {}) }), !!playerId)}
      </>
    )
  } else if (event.eventType === "SUBSTITUTION") {
    const outPool = withCurrent(linePool.filter(p => p.id !== event.playerInId), event.playerId)
    const inPool = withCurrent(benchPool, event.playerInId)
    body = (
      <>
        <p className="text-xs text-fg-muted">Went out</p>
        <div className="flex flex-wrap gap-1.5">
          {outPool.map(p => (
            <button key={p.id} type="button" aria-pressed={playerId === p.id} className={chip(playerId === p.id)} onClick={() => setPlayerId(p.id)} disabled={busy}>
              {p.first_name}
            </button>
          ))}
        </div>
        <p className="text-xs text-fg-muted">Came in</p>
        <div className="flex flex-wrap gap-1.5">
          {inPool.filter(p => p.id !== playerId).map(p => (
            <button key={p.id} type="button" aria-pressed={playerInId === p.id} className={chip(playerInId === p.id)} onClick={() => setPlayerInId(p.id)} disabled={busy}>
              {p.first_name}
            </button>
          ))}
        </div>
        {footer(() => onSave({ playerId, playerInId }), !!playerId && !!playerInId && playerId !== playerInId)}
      </>
    )
  } else {
    body = (
      <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {withCurrent(linePool, event.playerId).map(p => (
            <PlayerTile key={p.id} player={p} disabled={busy} selected={p.id === event.playerId} onClick={() => onSave({ playerId: p.id })} />
          ))}
        </div>
        {footer()}
      </>
    )
  }

  return <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3">{body}</div>
}
