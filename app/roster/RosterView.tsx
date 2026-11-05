"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Search, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Kbd } from "@/components/ui/kbd"
import { NativeSelect } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"
import type { Player } from "@/models/RosterModels"
import JerseyStage, { CaptainMark } from "./JerseyStage"
import {
  fullName, hasNumber, initials, playerSlug, searchRoster, sortRoster,
  type RosterFilter, type RosterSort,
} from "./roster-utils"

type RosterProps = { initialPlayers: Player[] }

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

export default function RosterView({ initialPlayers }: RosterProps) {
  const players = initialPlayers
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<RosterFilter>("all")
  const [sort, setSort] = useState<RosterSort>("number")

  const sorted = useMemo(() => sortRoster(players, sort), [players, sort])
  const visible = useMemo(
    () => searchRoster(filter === "captains" ? sorted.filter(p => p.is_captain) : sorted, query),
    [sorted, filter, query]
  )
  const captainCount = useMemo(() => players.filter(p => p.is_captain).length, [players])

  // `selectedId` moves instantly (list highlight + stage text). `dressedId` is what the jersey wears:
  // during a run of arrow presses it waits for the keys to settle, so the jersey spins once, not per step.
  const [selectedId, setSelectedId] = useState(sorted[0]?.id)
  const [dressedId, setDressedId] = useState(sorted[0]?.id)
  const dressTimer = useRef<number | undefined>(undefined)

  const chosen = useRef(false) // only put ?p= in the URL once someone actually picks a player
  const select = useCallback((id: string, { settle = false } = {}) => {
    chosen.current = true
    setSelectedId(id)
    window.clearTimeout(dressTimer.current)
    if (settle) dressTimer.current = window.setTimeout(() => setDressedId(id), 320)
    else setDressedId(id)
  }, [])

  // Shareable selection: ?p=first-last
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("p")
    const match = slug && players.find(p => playerSlug(p) === slug)
    if (match) select(match.id)
  }, [players, select])
  useEffect(() => {
    const p = players.find(x => x.id === dressedId)
    if (!p || !chosen.current) return
    const url = new URL(window.location.href)
    if (url.searchParams.get("p") === playerSlug(p)) return
    url.searchParams.set("p", playerSlug(p))
    window.history.replaceState(window.history.state, "", url)
  }, [dressedId, players])

  const selected = players.find(p => p.id === selectedId) ?? sorted[0]
  const dressed = players.find(p => p.id === dressedId) ?? selected
  const index = visible.findIndex(p => p.id === selected?.id)

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const optionId = (id: string) => `${listId}-${id}`

  const step = useCallback((delta: 1 | -1, opts?: { settle?: boolean }) => {
    if (!visible.length) return
    const next = index === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, index + delta))
    const p = visible[next]
    select(p.id, opts)
    document.getElementById(optionId(p.id))?.scrollIntoView({ block: "nearest" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, index, select])

  // Keyboard: ↑/↓ browse from anywhere, typing jumps into search, "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const inField = isTextField(e.target)
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (inField && e.target !== searchRef.current) return
        e.preventDefault()
        step(e.key === "ArrowDown" ? 1 : -1, { settle: true })
        return
      }
      if (inField) return
      if (e.key === "/") {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        searchRef.current?.focus() // the character lands in the field
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [step])

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const p = index === -1 ? visible[0] : visible[index]
      if (p) {
        select(p.id)
        document.getElementById(optionId(p.id))?.scrollIntoView({ block: "nearest" })
      }
    } else if (e.key === "Escape" && query) {
      e.preventDefault()
      setQuery("")
    }
  }

  const onListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (selected) select(selected.id)
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault()
      const p = e.key === "Home" ? visible[0] : visible[visible.length - 1]
      if (p) {
        select(p.id)
        document.getElementById(optionId(p.id))?.scrollIntoView({ block: "nearest" })
      }
    }
  }

  const countText = query || filter === "captains"
    ? `${visible.length} of ${players.length} players`
    : `${players.length} players, ${captainCount} captains`

  if (!selected) return null

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-10">
      <div className="contents lg:col-span-7 lg:block">
        <JerseyStage
          player={selected}
          dressed={dressed}
          onStep={d => step(d)}
          canPrev={index > 0}
          canNext={index !== -1 && index < visible.length - 1}
        />
      </div>

      <div className="min-w-0 lg:col-span-5">
        <header className="mb-4 flex items-end justify-between gap-4 lg:mb-6">
          <h1 className="font-display text-5xl leading-none tracking-wide text-foreground lg:text-7xl">Roster</h1>
          <p className="pb-1 text-sm text-fg-muted" aria-live="polite">{countText}</p>
        </header>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label htmlFor={`${listId}-search`} className="sr-only">Search by name or number</label>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
            <input
              ref={searchRef}
              id={`${listId}-search`}
              type="search"
              inputMode="search"
              autoComplete="off"
              enterKeyHint="go"
              placeholder="Name or number"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              aria-controls={listId}
              aria-activedescendant={selected && index !== -1 ? optionId(selected.id) : undefined}
              className="peer h-11 w-full rounded-md border border-input bg-surface pl-9 pr-10 text-base text-foreground transition-[border-color] placeholder:text-fg-muted hover:border-border-strong lg:h-10 lg:text-sm [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear search"
                onClick={() => { setQuery(""); searchRef.current?.focus() }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-muted"
              >
                <X />
              </Button>
            ) : (
              <Kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 peer-focus:hidden">/</Kbd>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div role="group" aria-label="Show" className="flex h-11 items-center rounded-md border border-input bg-surface p-0.5 lg:h-10">
              {(["all", "captains"] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "h-full rounded-[calc(var(--radius)-2px)] px-3 text-sm transition-colors",
                    filter === f ? "bg-surface-3 font-medium text-foreground" : "text-fg-secondary hover:text-foreground"
                  )}
                >
                  {f === "all" ? "All" : "Captains"}
                </button>
              ))}
            </div>
            <label htmlFor={`${listId}-sort`} className="sr-only">Sort players</label>
            <NativeSelect
              id={`${listId}-sort`}
              value={sort}
              onChange={e => setSort(e.target.value as RosterSort)}
              className="w-auto flex-1 sm:w-36 sm:flex-none [&_select]:h-11 lg:[&_select]:h-10"
            >
              <option value="number">By number</option>
              <option value="name">By name</option>
            </NativeSelect>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={<Users className="size-5" />}
            title={query ? `No one matches “${query}”` : "No captains listed"}
            description={query ? "Try a first name, last name or jersey number." : undefined}
            action={query ? <Button variant="outline" onClick={() => setQuery("")}>Clear search</Button> : undefined}
          />
        ) : (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Players"
            tabIndex={0}
            aria-activedescendant={index !== -1 ? optionId(selected.id) : undefined}
            onKeyDown={onListKey}
            className="mt-4 rounded-xl outline-offset-2 lg:mt-5"
          >
            {visible.map(p => {
              const isSel = p.id === selected.id
              return (
                <li
                  key={p.id}
                  id={optionId(p.id)}
                  role="option"
                  aria-selected={isSel}
                  aria-label={`${fullName(p)}${hasNumber(p) ? `, number ${p.number}` : ""}${p.is_captain ? ", captain" : ""}`}
                  onClick={() => select(p.id)}
                  className={cn(
                    // Fixed 48px rows; selection only changes colour, never size or position.
                    "group relative grid h-12 cursor-pointer select-none grid-cols-[3.5rem_1fr_auto] items-center gap-3 rounded-md pr-3",
                    "scroll-mt-[22rem] scroll-mb-4 lg:scroll-mt-28",
                    "[-webkit-tap-highlight-color:transparent]",
                    isSel ? "bg-surface-2" : "hover:bg-surface"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand transition-opacity",
                      isSel ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "text-right font-display text-3xl leading-none tracking-wide tabular-nums",
                      hasNumber(p) ? (isSel ? "text-foreground" : "text-fg-secondary") : "text-transparent"
                    )}
                    style={hasNumber(p) ? undefined : { WebkitTextStroke: "1px var(--fg-muted)" }}
                  >
                    {hasNumber(p) ? p.number : initials(p)}
                  </span>
                  <span aria-hidden className="truncate text-[15px] text-foreground">
                    <span className={cn(isSel ? "text-foreground" : "text-fg-secondary")}>{p.first_name} </span>
                    <span className="font-medium">{p.last_name}</span>
                  </span>
                  <span aria-hidden className="flex w-5 justify-end">{p.is_captain && <CaptainMark />}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
