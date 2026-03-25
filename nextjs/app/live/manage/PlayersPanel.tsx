"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import type { PlayerItem } from "@/lib/aws/players"

type ParsedRow =
  | { valid: true; raw: string; first_name: string; last_name: string; number: number; jersey_name_text?: string }
  | { valid: false; raw: string; error: string }

function parsePlayerLines(text: string, team: "VOID" | "NULL"): ParsedRow[] {
  return text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(raw => {
      const parts = raw.split(",").map(s => s.trim())
      const nameParts = (parts[0] ?? "").split(/\s+/).filter(Boolean)
      const number = parseInt(parts[1] ?? "")
      if (nameParts.length < 2 || isNaN(number)) {
        return { valid: false as const, raw, error: "Need: First Last, Number" }
      }
      return {
        valid: true as const,
        raw,
        first_name: nameParts[0],
        last_name: nameParts.slice(1).join(" "),
        number,
        team,
        jersey_name_text: parts[2] || undefined,
      }
    })
}

export function PlayersPanel() {
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PlayerItem | null>(null)

  useEffect(() => {
    fetch("/api/players")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setPlayers(data)
        else setError(data.error ?? "Failed to load players")
      })
      .catch(() => setError("Failed to load players"))
      .finally(() => setIsLoading(false))
  }, [])

  const columns: ColumnDef<PlayerItem>[] = [
    {
      header: "Name",
      cell: row => (
        <span className="font-medium">
          {row.first_name} {row.last_name}
          {row.is_captain && <Badge variant="secondary" className="ml-2 text-xs">C</Badge>}
        </span>
      ),
    },
    { header: "#", cell: row => <span className="font-mono text-sm text-white/60">#{row.number}</span> },
    { header: "Team", accessorKey: "team" },
    {
      header: "Jersey",
      cell: row => row.jersey_name_text
        ? <span className="text-white/50 text-xs font-mono">{row.jersey_name_text}</span>
        : <span className="text-white/20">—</span>,
    },
    {
      header: "Status",
      cell: row => row.is_active
        ? <span className="text-green-400/70 text-xs">Active</span>
        : <span className="text-white/30 text-xs">Inactive</span>,
    },
    {
      header: "",
      cell: row => (
        <button
          onClick={() => setEditTarget(row)}
          className="text-white/30 hover:text-white text-sm transition-colors"
        >
          Edit
        </button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end gap-2">
        <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">Bulk Add</Button>
          </DialogTrigger>
          <DialogContent className="bg-black border-white/10 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle>Bulk Add Players</DialogTitle>
            </DialogHeader>
            <BulkAddForm
              onAdded={newPlayers => {
                setPlayers(prev => [...newPlayers, ...prev])
                setBulkOpen(false)
              }}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">+ Add Player</Button>
          </DialogTrigger>
          <DialogContent className="bg-black border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle>Add Player</DialogTitle>
            </DialogHeader>
            <AddPlayerForm
              onCreated={player => {
                setPlayers(prev => [player, ...prev])
                setAddOpen(false)
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <DataTable
        columns={columns}
        data={players}
        isLoading={isLoading}
        getRowKey={p => p.id}
        emptyMessage="No players yet. Use Bulk Add to import a roster."
      />

      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null) }}>
        <DialogContent className="bg-black border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Player</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <EditPlayerForm
              player={editTarget}
              onSaved={updated => {
                setPlayers(prev => prev.map(p => p.id === updated.id ? updated : p))
                setEditTarget(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// --- Bulk Add Form ---
function BulkAddForm({ onAdded }: { onAdded: (players: PlayerItem[]) => void }) {
  const [text, setText] = useState("")
  const [team, setTeam] = useState<"VOID" | "NULL">("VOID")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ added: PlayerItem[]; failed: { input: string; reason: string }[] } | null>(null)

  const parsed = text.trim() ? parsePlayerLines(text, team) : []
  const valid = parsed.filter(r => r.valid)
  const invalid = parsed.filter(r => !r.valid)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (valid.length === 0) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch("/api/players/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players: valid }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult({ added: [], failed: valid.map(p => ({ input: p.raw, reason: data.error ?? "Failed" })) })
        return
      }
      setResult(data)
      if (data.added?.length > 0) {
        setText("")
        onAdded(data.added)
      }
    } catch {
      setResult({ added: [], failed: valid.map(p => ({ input: p.raw, reason: "Network error" })) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="text-sm text-white/40 bg-white/5 rounded-lg p-3 font-mono leading-relaxed">
        One player per line: <span className="text-white/60">First Last, Number</span><br />
        Optional jersey name: <span className="text-white/60">First Last, Number, JERSEY</span>
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-white/50 shrink-0">Team</Label>
        <select
          value={team}
          onChange={e => setTeam(e.target.value as "VOID" | "NULL")}
          className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none"
        >
          <option value="VOID" className="bg-neutral-900">VOID</option>
          <option value="NULL" className="bg-neutral-900">NULL</option>
        </select>
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={"Jon Melitski, 6\nAlan Wu, 69\nCole Woodward, 5, PRESIDENT"}
        rows={8}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
      />

      {/* Live preview */}
      {parsed.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-white/40">{valid.length} valid · {invalid.length} invalid</p>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {parsed.map((row, i) =>
              row.valid ? (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                  #{row.number} {row.first_name} {row.last_name}
                </span>
              ) : (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-400/15 text-red-400" title={row.error}>
                  {row.raw.slice(0, 20)}{row.raw.length > 20 ? "…" : ""}
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div className="flex flex-col gap-1.5 text-sm">
          {result.added.length > 0 && (
            <p className="text-green-400">{result.added.length} player{result.added.length !== 1 ? "s" : ""} added.</p>
          )}
          {result.failed.length > 0 && (
            <div>
              <p className="text-red-400 mb-1">{result.failed.length} failed:</p>
              {result.failed.map((f, i) => (
                <p key={i} className="text-white/40 text-xs pl-2">{f.input} — {f.reason}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <Button type="submit" disabled={submitting || valid.length === 0}>
        {submitting ? "Adding…" : `Add ${valid.length || ""} Player${valid.length !== 1 ? "s" : ""}`}
      </Button>
    </form>
  )
}

// --- Edit Player Form ---
function EditPlayerForm({ player, onSaved }: { player: PlayerItem; onSaved: (updated: PlayerItem) => void }) {
  const [firstName, setFirstName] = useState(player.first_name)
  const [lastName, setLastName] = useState(player.last_name)
  const [number, setNumber] = useState(String(player.number))
  const [team, setTeam] = useState<"VOID" | "NULL">(player.team)
  const [jerseyName, setJerseyName] = useState(player.jersey_name_text ?? "")
  const [isCaptain, setIsCaptain] = useState(player.is_captain)
  const [isActive, setIsActive] = useState(player.is_active)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName || !lastName || !number) { setError("First name, last name, and number are required"); return }
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch(`/api/players/${player.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          number: parseInt(number),
          team,
          is_captain: isCaptain,
          is_active: isActive,
          jersey_name_text: jerseyName.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Failed to update player")
        return
      }
      onSaved(await res.json())
    } catch {
      setError("Failed to update player")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <Label>First Name *</Label>
          <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jon" />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <Label>Last Name *</Label>
          <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Melitski" />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 w-24">
          <Label>Number *</Label>
          <Input type="number" value={number} onChange={e => setNumber(e.target.value)} placeholder="6" min={0} max={99} />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <Label>Team</Label>
          <select
            value={team}
            onChange={e => setTeam(e.target.value as "VOID" | "NULL")}
            className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none h-10"
          >
            <option value="VOID" className="bg-neutral-900">VOID</option>
            <option value="NULL" className="bg-neutral-900">NULL</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Jersey Name <span className="text-white/30 font-normal">(optional)</span></Label>
        <Input value={jerseyName} onChange={e => setJerseyName(e.target.value)} placeholder="e.g. PRESIDENT" />
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
          <input type="checkbox" checked={isCaptain} onChange={e => setIsCaptain(e.target.checked)} className="rounded" />
          Team captain
        </label>
        <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
          Active
        </label>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save Changes"}
      </Button>
    </form>
  )
}

// --- Single Add Form ---
function AddPlayerForm({ onCreated }: { onCreated: (player: PlayerItem) => void }) {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [number, setNumber] = useState("")
  const [team, setTeam] = useState<"VOID" | "NULL">("VOID")
  const [jerseyName, setJerseyName] = useState("")
  const [isCaptain, setIsCaptain] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName || !lastName || !number) { setError("First name, last name, and number are required"); return }
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          number: parseInt(number),
          team,
          is_captain: isCaptain,
          ...(jerseyName.trim() ? { jersey_name_text: jerseyName.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Failed to create player")
        return
      }
      onCreated(await res.json())
    } catch {
      setError("Failed to create player")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <Label>First Name *</Label>
          <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jon" />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <Label>Last Name *</Label>
          <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Melitski" />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 w-24">
          <Label>Number *</Label>
          <Input type="number" value={number} onChange={e => setNumber(e.target.value)} placeholder="6" min={0} max={99} />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <Label>Team</Label>
          <select
            value={team}
            onChange={e => setTeam(e.target.value as "VOID" | "NULL")}
            className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none h-10"
          >
            <option value="VOID" className="bg-neutral-900">VOID</option>
            <option value="NULL" className="bg-neutral-900">NULL</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Jersey Name <span className="text-white/30 font-normal">(optional)</span></Label>
        <Input value={jerseyName} onChange={e => setJerseyName(e.target.value)} placeholder="e.g. PRESIDENT" />
      </div>

      <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
        <input type="checkbox" checked={isCaptain} onChange={e => setIsCaptain(e.target.checked)} className="rounded" />
        Team captain
      </label>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Adding…" : "Add Player"}
      </Button>
    </form>
  )
}
