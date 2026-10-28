"use client"

import { useEffect, useRef, useState } from "react"
import { Command } from "cmdk"
import { Check, Loader2 } from "lucide-react"
import type { PlayerItem } from "@/lib/aws/players"
import { scorePlayer } from "./PlayerPicker"

interface LineEditorProps {
  initialIds: string[]
  players: PlayerItem[]
  /** Players with events in this point — removing them leaves those events pointing off the line */
  playerIdsWithEvents: Set<string>
  onSave: (playerIds: string[]) => Promise<void>
  onCancel: () => void
  className?: string
  style?: React.CSSProperties
}

const LINE_SIZE = 7

/** Keyboard-first line editor: type a number or name, Enter toggles, ⌘Enter saves, Esc cancels */
export function LineEditor({ initialIds, players, playerIdsWithEvents, onSave, onCancel, className, style }: LineEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [ids, setIds] = useState<string[]>(initialIds)
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(ids)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save line")
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })

  // Esc / outside click cancel and ⌘Enter saves, regardless of focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel() }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); saveRef.current() }
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

  const toggle = (id: string) => {
    setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setSearch("")
  }

  const onLine = new Set(ids)
  const byNumber = (a: PlayerItem, b: PlayerItem) => a.number - b.number
  const candidates = players.filter(p => p.is_active || onLine.has(p.id) || initialIds.includes(p.id))
  const current = candidates.filter(p => onLine.has(p.id)).sort(byNumber)
  const others = candidates.filter(p => !onLine.has(p.id)).sort(byNumber)
  const removedWithEvents = initialIds.filter(id => !onLine.has(id) && playerIdsWithEvents.has(id))
  const nameOf = (id: string) => {
    const p = players.find(x => x.id === id)
    return p ? `#${p.number} ${p.first_name}` : "Unknown"
  }

  const renderItem = (p: PlayerItem) => {
    const checked = onLine.has(p.id)
    return (
      <Command.Item
        key={p.id}
        value={`${p.number} ${p.first_name} ${p.last_name} ${p.id}`}
        onSelect={() => toggle(p.id)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-white/70 cursor-pointer data-[selected=true]:bg-white/15 data-[selected=true]:text-white"
      >
        <span className={`flex items-center justify-center w-3.5 h-3.5 rounded border ${checked ? "bg-white border-white text-black" : "border-white/25"}`}>
          {checked && <Check size={10} strokeWidth={3} />}
        </span>
        <span className="font-mono text-white/40 w-6 text-right tabular-nums">{p.number}</span>
        <span className="truncate">{p.first_name} {p.last_name}</span>
      </Command.Item>
    )
  }

  const groupClass = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-white/30"

  return (
    <Command
      ref={rootRef}
      filter={scorePlayer}
      loop
      className={`w-72 rounded-xl border border-white/15 bg-neutral-950/95 backdrop-blur-sm shadow-2xl shadow-black/60 overflow-hidden ${className ?? ""}`}
      style={style}
    >
      <div className="flex items-center px-3 pt-2.5 pb-1">
        <p className="text-[10px] uppercase tracking-widest text-white/40">Line</p>
        <span className={`ml-auto text-[10px] font-mono ${ids.length === LINE_SIZE ? "text-white/50" : "text-amber-300"}`}>
          {ids.length}/{LINE_SIZE}
        </span>
      </div>
      <Command.Input
        autoFocus
        value={search}
        onValueChange={setSearch}
        placeholder="Number or name, Enter to toggle…"
        className="w-full bg-transparent border-b border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none"
      />
      <Command.List className="max-h-64 overflow-y-auto p-1.5">
        <Command.Empty className="px-2.5 py-2 text-xs text-white/30">No matching players</Command.Empty>
        {current.length > 0 && <Command.Group heading="On the line" className={groupClass}>{current.map(renderItem)}</Command.Group>}
        {others.length > 0 && <Command.Group heading="Bench" className={groupClass}>{others.map(renderItem)}</Command.Group>}
      </Command.List>
      {removedWithEvents.length > 0 && (
        <p className="px-3 py-1.5 border-t border-white/10 text-[10px] text-amber-300/90">
          {removedWithEvents.map(nameOf).join(", ")} {removedWithEvents.length === 1 ? "has" : "have"} events in this point
        </p>
      )}
      {error && <p className="px-3 py-1.5 border-t border-white/10 text-[10px] text-red-300">{error}</p>}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10">
        <span className="text-[10px] text-white/30">⌘Enter save · Esc cancel</span>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-xs text-white disabled:opacity-50 transition-colors"
        >
          {saving && <Loader2 size={11} className="animate-spin" />}
          Save line
        </button>
      </div>
    </Command>
  )
}
