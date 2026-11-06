"use client"

import type { GameStats, TurnoverCounts } from "@/lib/stats/derive"
import { FIELD_ZONE_LABELS, FIELD_ZONES, TURNOVER_TYPE_LABELS, type TurnoverType } from "@/lib/point-event-meta"
import type { ZoneCounts } from "@/lib/stats/derive"
import { PlayerStatsTable, toPlayerRows } from "./player-stats-table"

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <p className="truncate text-xs text-fg-muted">{label}</p>
      <p className="font-mono text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="truncate text-xs text-fg-muted">{sub}</p>}
    </div>
  )
}

const ratio = (made: number, of: number) => `${made}/${of}`
const pctText = (n: number | null) => (n === null ? "" : `${n}%`)

function zoneLine(c: ZoneCounts): string {
  return FIELD_ZONES.filter(z => c[z]).map(z => `${c[z]} ${FIELD_ZONE_LABELS[z].toLowerCase()}`).join(" · ") || "none tagged"
}

function turnoverLine(c: TurnoverCounts): string {
  const order: (TurnoverType | "UNSPECIFIED")[] = ["THROWAWAY", "DROP", "STALL", "BLOCKED", "OTHER", "UNSPECIFIED"]
  return order
    .filter(t => c.byType[t])
    .map(t => `${c.byType[t]} ${t === "UNSPECIFIED" ? "untyped" : TURNOVER_TYPE_LABELS[t].toLowerCase()}`)
    .join(" · ")
}

/** Team summary plus the player table, all from deriveGameStats (live points included as they're logged). */
export function GameStatsView({ stats, opponent }: { stats: GameStats; opponent: string }) {
  const { us } = stats.team
  const p = stats.possession
  const rows = toPlayerRows(stats.players)
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="team-stats-heading" className="flex flex-col gap-2">
        <h2 id="team-stats-heading" className="text-lg font-semibold">Team</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card label="Holds / O points" value={ratio(us.holds, us.oPoints)} sub={pctText(stats.oEfficiency)} />
          <Card label="Breaks / D points" value={ratio(us.breaks, us.dPoints)} sub={pctText(stats.dConversion)} />
          <Card label="Breaks / break chances" value={ratio(p.breaks, p.breakChances)} sub={pctText(p.breakConversion)} />
          <Card label={`${opponent} breaks / chances`} value={ratio(p.oppBreaks, p.oppBreakChances)} sub={pctText(p.oppBreakConversion)} />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Card label="VOID turnovers" value={String(stats.turnovers.us.total)} sub={turnoverLine(stats.turnovers.us) || undefined} />
          <Card label={`${opponent} turnovers`} value={String(stats.turnovers.them.total)} sub={turnoverLine(stats.turnovers.them) || undefined} />
        </div>
        {stats.hucks.attempts > 0 && (
          <Card
            label="Hucks: goals / attempts"
            value={ratio(stats.hucks.goals, stats.hucks.attempts)}
            sub={`${stats.hucks.turnovers} turned over${stats.hucks.pct !== null ? ` · ${stats.hucks.pct}% scored` : ""} (attempts = huck goals + huck turnovers)`}
          />
        )}
        {stats.zones.tagged > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Card label="Goals thrown from" value={String(Object.values(stats.zones.goalsFrom).reduce((a, b) => a + (b ?? 0), 0))} sub={zoneLine(stats.zones.goalsFrom)} />
            <Card label="Turnovers in" value={String(Object.values(stats.zones.turnovers).reduce((a, b) => a + (b ?? 0), 0))} sub={zoneLine(stats.zones.turnovers)} />
            <Card label="Won it back in" value={String(Object.values(stats.zones.gains).reduce((a, b) => a + (b ?? 0), 0))} sub={zoneLine(stats.zones.gains)} />
          </div>
        )}
      </section>

      <section aria-labelledby="player-stats-heading" className="flex flex-col gap-2">
        <h2 id="player-stats-heading" className="text-lg font-semibold">Players</h2>
        {rows.length > 0
          ? <PlayerStatsTable rows={rows} />
          : <p className="text-sm text-fg-muted">Player stats appear once points are played.</p>}
      </section>
    </div>
  )
}
