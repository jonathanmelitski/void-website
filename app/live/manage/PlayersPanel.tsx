"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/native-select"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { DataTable, ColumnDef } from "@/components/ui/data-table"
import { apiFetch } from "@/lib/api-fetch"
import { toast } from "@/components/ui/sonner"
import type { PlayerItem } from "@/lib/aws/players"
import { CONNECTION_HINT, friendlyError } from "./api-helpers"
import { FormFooter } from "./form-footer"

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

function PlayerStatus({ row }: { row: PlayerItem }) {
  return row.is_active
    ? <span className="text-success text-xs">Active</span>
    : <span className="text-fg-muted text-xs">Inactive</span>
}

export function PlayersPanel() {
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PlayerItem | null>(null)

  useEffect(() => {
    apiFetch("/api/players")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setPlayers(data)
        else setError("Couldn't load players. Reload to try again.")
      })
      .catch(() => setError(`Couldn't load players. ${CONNECTION_HINT}`))
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
    { header: "#", cell: row => <span className="font-mono tabular-nums text-sm text-fg-secondary">#{row.number}</span> },
    { header: "Team", accessorKey: "team" },
    {
      header: "Jersey",
      cell: row => row.jersey_name_text
        ? <span className="text-fg-muted text-xs">{row.jersey_name_text}</span>
        : <span className="text-fg-muted">—</span>,
    },
    { header: "Status", cell: row => <PlayerStatus row={row} /> },
    {
      header: "",
      cell: row => (
        <Button variant="ghost" size="sm" onClick={() => setEditTarget(row)}>Edit</Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Players</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 sm:h-8">Bulk add</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Bulk add players</DialogTitle>
              </DialogHeader>
              <BulkAddForm
                onAdded={(newPlayers, allAdded) => {
                  setPlayers(prev => [...newPlayers, ...prev])
                  // Keep the dialog open when some lines failed so the summary stays visible
                  if (allAdded) {
                    setBulkOpen(false)
                    toast.success(`Added ${newPlayers.length} player${newPlayers.length !== 1 ? "s" : ""}`)
                  }
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-10 sm:h-8">Add player</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add player</DialogTitle>
              </DialogHeader>
              <PlayerForm
                submitLabel="Add player"
                onSaved={player => {
                  setPlayers(prev => [player, ...prev])
                  setAddOpen(false)
                  toast.success("Player added")
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <DataTable
        columns={columns}
        data={players}
        isLoading={isLoading}
        getRowKey={p => p.id}
        emptyMessage="No players yet. Use Bulk add to import a roster."
        mobileCard={row => (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.first_name} {row.last_name}
                {row.is_captain && <Badge variant="secondary" className="ml-2 text-xs">C</Badge>}
              </p>
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <span className="font-mono tabular-nums">#{row.number}</span>
                <span>{row.team}</span>
                <PlayerStatus row={row} />
              </p>
            </div>
            <Button variant="ghost" size="sm" className="-mr-2 h-10" onClick={() => setEditTarget(row)}>Edit</Button>
          </div>
        )}
      />

      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit player</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <PlayerForm
              player={editTarget}
              submitLabel="Save changes"
              onSaved={updated => {
                setPlayers(prev => prev.map(p => p.id === updated.id ? updated : p))
                setEditTarget(null)
                toast.success("Player saved")
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// --- Bulk Add Form ---
function BulkAddForm({ onAdded }: { onAdded: (players: PlayerItem[], allAdded: boolean) => void }) {
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
      const res = await apiFetch("/api/players/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players: valid }),
        waitForSession: true,
      })
      if (!res.ok) {
        const reason = await friendlyError(res, "Couldn't add players. Try again.")
        setResult({ added: [], failed: valid.map(p => ({ input: p.raw, reason })) })
        return
      }
      const data = await res.json()
      setResult(data)
      if (data.added?.length > 0) {
        setText("")
        onAdded(data.added, !(data.failed?.length > 0))
      }
    } catch {
      setResult({ added: [], failed: valid.map(p => ({ input: p.raw, reason: CONNECTION_HINT })) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="text-sm text-fg-muted bg-surface rounded-xl p-3 leading-relaxed">
        One player per line: <span className="text-fg-secondary font-mono">First Last, Number</span><br />
        Optional jersey name: <span className="text-fg-secondary font-mono">First Last, Number, JERSEY</span>
      </div>

      <Field label="Team" className="w-40">
        <NativeSelect value={team} onChange={e => setTeam(e.target.value as "VOID" | "NULL")}>
          <option value="VOID">VOID</option>
          <option value="NULL">NULL</option>
        </NativeSelect>
      </Field>

      <Field label="Players">
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={"Alex Smith, 12\nJordan Lee, 7\nSam Park, 23, JERSEY NAME"}
          rows={8}
          className="font-mono resize-none"
        />
      </Field>

      {/* Live preview */}
      {parsed.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-fg-muted">{valid.length} valid · {invalid.length} invalid</p>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {parsed.map((row, i) =>
              row.valid ? (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-fg-secondary">
                  #{row.number} {row.first_name} {row.last_name}
                </span>
              ) : (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive" title={row.error}>
                  {row.raw.slice(0, 20)}{row.raw.length > 20 ? "…" : ""}
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div className="flex flex-col gap-1.5 text-sm" role="status">
          {result.added.length > 0 && (
            <p className="text-success">{result.added.length} player{result.added.length !== 1 ? "s" : ""} added.</p>
          )}
          {result.failed.length > 0 && (
            <div>
              <p className="text-destructive mb-1">{result.failed.length} not added:</p>
              {result.failed.map((f, i) => (
                <p key={i} className="text-fg-muted text-xs pl-2">{f.input} — {f.reason}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <FormFooter
        submitLabel={valid.length > 1 ? `Add ${valid.length} players` : "Add player"}
        isSubmitting={submitting}
        disabled={valid.length === 0}
      />
    </form>
  )
}

// --- Add / edit form ---
function PlayerForm({
  player,
  submitLabel,
  onSaved,
}: {
  /** Omit to create a new player. */
  player?: PlayerItem
  submitLabel: string
  onSaved: (player: PlayerItem) => void
}) {
  const [firstName, setFirstName] = useState(player?.first_name ?? "")
  const [lastName, setLastName] = useState(player?.last_name ?? "")
  const [number, setNumber] = useState(player ? String(player.number) : "")
  const [team, setTeam] = useState<"VOID" | "NULL">(player?.team ?? "VOID")
  const [jerseyName, setJerseyName] = useState(player?.jersey_name_text ?? "")
  const [isCaptain, setIsCaptain] = useState(player?.is_captain ?? false)
  const [isActive, setIsActive] = useState(player?.is_active ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<{ first?: string; last?: string; number?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof fieldErrors = {}
    if (!firstName.trim()) errs.first = "Enter a first name."
    if (!lastName.trim()) errs.last = "Enter a last name."
    if (number === "" || isNaN(parseInt(number))) errs.number = "Enter a number."
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSubmitting(true)
    setError("")
    const verb = player ? "save the player" : "add the player"
    try {
      const res = await apiFetch(player ? `/api/players/${player.id}` : "/api/players", {
        method: player ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          player
            ? {
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                number: parseInt(number),
                team,
                is_captain: isCaptain,
                is_active: isActive,
                jersey_name_text: jerseyName.trim() || undefined,
              }
            : {
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                number: parseInt(number),
                team,
                is_captain: isCaptain,
                ...(jerseyName.trim() ? { jersey_name_text: jerseyName.trim() } : {}),
              },
        ),
        waitForSession: true,
      })
      if (!res.ok) {
        setError(await friendlyError(res, `Couldn't ${verb}. Try again.`))
        return
      }
      onSaved(await res.json())
    } catch {
      setError(`Couldn't ${verb}. ${CONNECTION_HINT}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex gap-3">
        <Field label="First name" error={fieldErrors.first} className="flex-1 min-w-0">
          <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" />
        </Field>
        <Field label="Last name" error={fieldErrors.last} className="flex-1 min-w-0">
          <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" />
        </Field>
      </div>

      <div className="flex gap-3">
        <Field label="Number" error={fieldErrors.number} className="w-24">
          <Input type="number" inputMode="numeric" value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. 12" min={0} max={99} />
        </Field>
        <Field label="Team" className="flex-1">
          <NativeSelect value={team} onChange={e => setTeam(e.target.value as "VOID" | "NULL")}>
            <option value="VOID">VOID</option>
            <option value="NULL">NULL</option>
          </NativeSelect>
        </Field>
      </div>

      <Field label="Jersey name" hint="Optional. Printed on the back of the jersey.">
        <Input value={jerseyName} onChange={e => setJerseyName(e.target.value)} placeholder="e.g. SMITH" />
      </Field>

      <div className="flex flex-col">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={isCaptain} onChange={e => setIsCaptain(e.target.checked)} className="size-4 accent-foreground" />
          Team captain
        </label>
        {player && (
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg-secondary">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="size-4 accent-foreground" />
            Active
          </label>
        )}
      </div>

      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}

      <FormFooter submitLabel={submitLabel} isSubmitting={submitting} />
    </form>
  )
}
