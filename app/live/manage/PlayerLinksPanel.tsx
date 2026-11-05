"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SkeletonRow } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { apiFetch } from "@/lib/api-fetch"
import { useAuth } from "@/lib/use-auth"
import { toast } from "@/components/ui/sonner"
import type { PlayerItem } from "@/lib/aws/players"
import type { VoidPlayerLinkItem } from "@/lib/aws/player-links"
import { CONNECTION_HINT, friendlyError } from "./api-helpers"
import { useUserEmails } from "./use-user-emails"

export function PlayerLinksPanel() {
  const { user } = useAuth()
  const isAdmin = user?.groups.includes("ADMIN") ?? false
  const { emailFor } = useUserEmails(isAdmin)
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [links, setLinks] = useState<VoidPlayerLinkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [linkingPlayerId, setLinkingPlayerId] = useState<string | null>(null)
  const [cognitoSubInput, setCognitoSubInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [linkError, setLinkError] = useState("")
  const [unlinkTarget, setUnlinkTarget] = useState<{ link: VoidPlayerLinkItem; player: PlayerItem } | null>(null)
  const [isUnlinking, setIsUnlinking] = useState(false)

  const load = useCallback(async () => {
    try {
      const [playersRes, linksRes] = await Promise.all([
        apiFetch("/api/players"),
        apiFetch("/api/player-links"),
      ])
      if (playersRes.ok) setPlayers(await playersRes.json())
      if (linksRes.ok) setLinks(await linksRes.json())
      setLoadError(playersRes.ok && linksRes.ok ? "" : "Couldn't load player links. Reload to try again.")
    } catch {
      setLoadError(`Couldn't load player links. ${CONNECTION_HINT}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const linkPlayer = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!linkingPlayerId || submitting) return
    if (!cognitoSubInput.trim()) { setLinkError("Paste the player's account ID."); return }
    setSubmitting(true)
    setLinkError("")
    try {
      const res = await apiFetch("/api/player-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cognitoSub: cognitoSubInput.trim(), playerId: linkingPlayerId }),
        waitForSession: true,
      })
      if (!res.ok) {
        setLinkError(await friendlyError(res, "Couldn't link the account. Check the ID and try again."))
        return
      }
      setLinkingPlayerId(null)
      setCognitoSubInput("")
      toast.success("Account linked")
      await load()
    } catch {
      setLinkError(`Couldn't link the account. ${CONNECTION_HINT}`)
    } finally {
      setSubmitting(false)
    }
  }, [linkingPlayerId, cognitoSubInput, submitting, load])

  async function unlinkPlayer() {
    if (!unlinkTarget) return
    setIsUnlinking(true)
    try {
      const res = await apiFetch(`/api/player-links/${unlinkTarget.link.cognitoSub}`, { method: "DELETE", waitForSession: true })
      if (!res.ok) {
        toast.error(await friendlyError(res, "Couldn't unlink the account. Try again."))
        return
      }
      setLinks(prev => prev.filter(l => l.cognitoSub !== unlinkTarget.link.cognitoSub))
      toast.success("Account unlinked")
    } catch {
      toast.error(`Couldn't unlink the account. ${CONNECTION_HINT}`)
    } finally {
      setIsUnlinking(false)
      setUnlinkTarget(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <SkeletonRow /><SkeletonRow /><SkeletonRow />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 text-left">
      <p className="text-sm text-fg-muted">
        Link each player&apos;s account to their roster entry. Players find their account ID on{" "}
        <span className="text-fg-secondary font-mono">/live/me</span> while signed in.
      </p>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <div className="flex flex-col gap-2">
        {players.filter(p => p.team === "VOID" && p.is_active).map(player => {
          const link = links.find(l => l.playerId === player.id)
          const isLinking = linkingPlayerId === player.id
          const linkedEmail = link ? emailFor(link.cognitoSub) : undefined

          return (
            <div
              key={player.id}
              className="flex flex-col gap-2 px-4 py-3 rounded-xl border border-border"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">
                    <span className="font-mono tabular-nums">#{player.number}</span> {player.first_name} {player.last_name}
                  </span>
                  {link && (
                    linkedEmail
                      ? <p className="text-xs text-fg-muted mt-0.5 truncate">{linkedEmail}</p>
                      : <p className="text-xs text-fg-muted font-mono mt-0.5 truncate">{link.cognitoSub}</p>
                  )}
                </div>
                <div className="-mr-2 flex items-center gap-2 shrink-0">
                  {link ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-10 sm:h-8 text-destructive hover:text-destructive"
                      onClick={() => setUnlinkTarget({ link, player })}
                    >
                      Unlink
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-10 sm:h-8"
                      onClick={() => {
                        setLinkingPlayerId(isLinking ? null : player.id)
                        setCognitoSubInput("")
                        setLinkError("")
                      }}
                    >
                      {isLinking ? "Cancel" : "Link account"}
                    </Button>
                  )}
                </div>
              </div>

              {isLinking && (
                <form onSubmit={linkPlayer} noValidate className="flex flex-col gap-1.5">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      autoFocus
                      aria-label="Account ID"
                      aria-invalid={linkError ? true : undefined}
                      value={cognitoSubInput}
                      onChange={e => setCognitoSubInput(e.target.value)}
                      placeholder="Paste the account ID from the player's /live/me page"
                      className="h-10 sm:h-9 flex-1 font-mono"
                    />
                    <Button type="submit" className="h-10 sm:h-9" loading={submitting}>
                      Link account
                    </Button>
                  </div>
                  {linkError && <p role="alert" className="text-sm text-destructive">{linkError}</p>}
                </form>
              )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={unlinkTarget !== null}
        onOpenChange={open => { if (!open && !isUnlinking) setUnlinkTarget(null) }}
        title="Unlink account?"
        description={
          unlinkTarget
            ? <>
                <span className="font-medium text-foreground">{unlinkTarget.player.first_name} {unlinkTarget.player.last_name}</span>{" "}
                won&apos;t see their footage on /live/me until the account is linked again.
              </>
            : ""
        }
        confirmLabel="Unlink account"
        isLoading={isUnlinking}
        onConfirm={unlinkPlayer}
      />
    </div>
  )
}
