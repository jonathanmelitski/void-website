"use client"

import { useEffect, useRef } from "react"
import { Command } from "cmdk"
import type { PlayerItem } from "@/lib/aws/players"

export type PickerMode =
  | { kind: "player"; title: string; preferIds: string[]; excludeIds?: string[] }
  | { kind: "team"; title: string }

interface PlayerPickerProps {
  mode: PickerMode
  players: PlayerItem[]
  onPick: (value: string) => void
  onCancel: () => void
  className?: string
  style?: React.CSSProperties
}

// Item values are "<number> <first> <last> <id>": digits match jersey numbers, letters match names
export function scorePlayer(value: string, search: string) {
  const q = search.trim().toLowerCase()
  if (!q) return 1
  const parts = value.toLowerCase().split(" ")
  const num = parts[0]
  if (/^\d+$/.test(q)) return num === q ? 1 : num.startsWith(q) ? 0.6 : 0
  const name = parts.slice(1, -1).join(" ")
  if (name.startsWith(q)) return 0.9
  if (name.split(" ").some(w => w.startsWith(q))) return 0.8
  return name.includes(q) ? 0.4 : 0
}

const itemClass =
  "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-white/70 cursor-pointer data-[selected=true]:bg-white/15 data-[selected=true]:text-white"

/** Keyboard-first picker: type a jersey number or name, Enter to pick, Esc to cancel */
export function PlayerPicker({ mode, players, onPick, onCancel, className, style }: PlayerPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Esc and outside clicks close the picker no matter where keyboard focus ended up
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onCancel()
    }
    document.addEventListener("keydown", onKey, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
    }
  }, [onCancel])

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Team picks are a single keystroke
    if (mode.kind === "team" && !e.metaKey && !e.ctrlKey) {
      if (e.key === "v" || e.key === "V") { e.preventDefault(); onPick("VOID") }
      if (e.key === "o" || e.key === "O") { e.preventDefault(); onPick("OPP") }
    }
  }

  const panelClass = `w-64 rounded-xl border border-white/15 bg-neutral-950/95 backdrop-blur-sm shadow-2xl shadow-black/60 overflow-hidden ${className ?? ""}`

  if (mode.kind === "team") {
    return (
      <Command ref={rootRef} className={panelClass} style={style} onKeyDown={onKeyDown} shouldFilter={false} loop>
        <p className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-widest text-white/40">{mode.title}</p>
        <Command.Input autoFocus className="sr-only" aria-label="Team" />
        <Command.List className="p-1.5">
          <Command.Item value="VOID" onSelect={() => onPick("VOID")} className={itemClass}>
            <kbd className="font-mono text-[10px] text-white/40 w-4">V</kbd> Void
          </Command.Item>
          <Command.Item value="OPP" onSelect={() => onPick("OPP")} className={itemClass}>
            <kbd className="font-mono text-[10px] text-white/40 w-4">O</kbd> Opponent
          </Command.Item>
        </Command.List>
      </Command>
    )
  }

  const exclude = new Set(mode.excludeIds ?? [])
  const prefer = new Set(mode.preferIds)
  const candidates = players.filter(p => !exclude.has(p.id) && (p.is_active || prefer.has(p.id)))
  const byNumber = (a: PlayerItem, b: PlayerItem) => a.number - b.number
  const preferred = candidates.filter(p => prefer.has(p.id)).sort(byNumber)
  const others = candidates.filter(p => !prefer.has(p.id)).sort(byNumber)

  const renderItem = (p: PlayerItem) => (
    <Command.Item
      key={p.id}
      value={`${p.number} ${p.first_name} ${p.last_name} ${p.id}`}
      onSelect={() => onPick(p.id)}
      className={itemClass}
    >
      <span className="font-mono text-white/40 w-6 text-right tabular-nums">{p.number}</span>
      <span className="truncate">{p.first_name} {p.last_name}</span>
    </Command.Item>
  )

  return (
    <Command ref={rootRef} className={panelClass} style={style} onKeyDown={onKeyDown} filter={scorePlayer} loop>
      <p className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-widest text-white/40">{mode.title}</p>
      <Command.Input
        autoFocus
        placeholder="Number or name…"
        className="w-full bg-transparent border-b border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none"
      />
      <Command.List className="max-h-56 overflow-y-auto p-1.5">
        <Command.Empty className="px-2.5 py-2 text-xs text-white/30">No matching players</Command.Empty>
        {preferred.length > 0 && (
          <Command.Group heading="On the line" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-white/30">
            {preferred.map(renderItem)}
          </Command.Group>
        )}
        {others.length > 0 && (
          <Command.Group heading={preferred.length > 0 ? "Others" : "Players"} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-white/30">
            {others.map(renderItem)}
          </Command.Group>
        )}
      </Command.List>
    </Command>
  )
}
