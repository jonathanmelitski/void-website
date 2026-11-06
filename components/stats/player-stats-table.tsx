"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PlayerStats } from "@/lib/stats/derive"

type Col = {
  key: string
  short: string
  long: string
  value: (s: PlayerStats) => number | null
  format?: (s: PlayerStats) => string
  /** Plus/minus colours its sign. */
  signed?: boolean
}

const pct = (n: number | null, made: number, of: number) => (n === null ? "—" : `${n}%`) + (of ? ` ${made}/${of}` : "")

const COLUMNS: Col[] = [
  { key: "pp", short: "PP", long: "Points played", value: s => s.pointsPlayed },
  { key: "pm", short: "+/-", long: "Plus/minus (G + A + B − T)", value: s => s.plusMinus, signed: true },
  { key: "g", short: "G", long: "Goals", value: s => s.goals },
  { key: "a", short: "A", long: "Assists", value: s => s.assists },
  { key: "ha", short: "HA", long: "Hockey assists", value: s => s.hockeyAssists },
  { key: "t", short: "T", long: "Turnovers", value: s => s.turnovers },
  { key: "b", short: "B", long: "Blocks", value: s => s.blocks },
  { key: "pl", short: "Pl", long: "Pulls", value: s => s.pulls },
  {
    key: "hk", short: "Hk", long: "Hucks thrown: huck assists / huck attempts (assists + huck turnovers)",
    value: s => (s.huckAssists + s.huckTurnovers ? s.huckAssists : null),
    format: s => (s.huckAssists + s.huckTurnovers ? `${s.huckAssists}/${s.huckAssists + s.huckTurnovers}` : "—"),
  },
  { key: "o", short: "O%", long: "O-line efficiency: holds / O points played", value: s => s.oEfficiency, format: s => pct(s.oEfficiency, s.oHolds, s.oPoints) },
  { key: "d", short: "D%", long: "D-line efficiency: breaks / D points played", value: s => s.dEfficiency, format: s => pct(s.dEfficiency, s.dBreaks, s.dPoints) },
]

export type PlayerRow = PlayerStats & { name: string; number?: number | null }

/**
 * Per-player game stats from deriveGameStats. Tap a column to sort (again to flip). The name column
 * stays put while the numbers scroll sideways on a phone.
 */
export function PlayerStatsTable({ rows, className }: { rows: PlayerRow[]; className?: string }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "pm", desc: true })
  const col = COLUMNS.find(c => c.key === sort.key) ?? COLUMNS[1]
  const sorted = [...rows].sort((a, b) => {
    const va = col.value(a), vb = col.value(b)
    if (va === null && vb === null) return a.name.localeCompare(b.name)
    if (va === null) return 1 // no data sinks, whichever way
    if (vb === null) return -1
    return (sort.desc ? vb - va : va - vb) || b.pointsPlayed - a.pointsPlayed || a.name.localeCompare(b.name)
  })

  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-fg-muted">
              <th scope="col" className="sticky left-0 z-10 bg-card py-2 pl-3 pr-2 text-left font-medium">Player</th>
              {COLUMNS.map(c => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"} className="px-1 py-1 text-right font-medium">
                  <button
                    type="button"
                    onClick={() => setSort(s => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
                    title={c.long}
                    className={cn("inline-flex min-h-10 items-center gap-0.5 rounded-md px-1.5 whitespace-nowrap hover:text-foreground", sort.key === c.key && "text-foreground")}
                  >
                    <abbr title={c.long} className="no-underline">{c.short}</abbr>
                    {sort.key === c.key && (sort.desc ? <ArrowDown aria-hidden className="size-3" /> : <ArrowUp aria-hidden className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map(r => (
              <tr key={r.playerId}>
                <th scope="row" className="sticky left-0 z-10 max-w-[9rem] truncate bg-card py-2 pl-3 pr-2 text-left font-normal">
                  {r.name}
                  {r.number != null && <span className="ml-1.5 text-xs text-fg-muted">#{r.number}</span>}
                </th>
                {COLUMNS.map(c => {
                  const v = c.value(r)
                  const text = c.format ? c.format(r) : v === null ? "—" : c.signed && v > 0 ? `+${v}` : String(v)
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums",
                        !v ? "text-fg-faint" : c.signed ? (v > 0 ? "text-success" : "text-destructive") : "text-foreground",
                      )}
                    >
                      {text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        +/- = goals + assists + blocks − turnovers · Hk huck assists / huck attempts · O% holds / O points played · D% breaks / D points played (scored points only)
      </p>
    </div>
  )
}

/** Rows for the table: roster players with at least one point or stat. */
export function toPlayerRows(players: PlayerStats[]): PlayerRow[] {
  return players
    .filter(s => s.player && (s.pointsPlayed > 0 || s.goals + s.assists + s.hockeyAssists + s.turnovers + s.blocks + s.pulls > 0))
    .map(s => ({ ...s, name: `${s.player!.first_name} ${s.player!.last_name}`.trim(), number: s.player!.number }))
}
