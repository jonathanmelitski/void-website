"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import type { PlayerItem } from "@/lib/aws/players"
import type { VoidPlayerLinkItem } from "@/lib/aws/player-links"

export function PlayerLinksPanel() {
  const [players, setPlayers] = useState<PlayerItem[]>([])
  const [links, setLinks] = useState<VoidPlayerLinkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [linkingPlayerId, setLinkingPlayerId] = useState<string | null>(null)
  const [cognitoSubInput, setCognitoSubInput] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [playersRes, linksRes] = await Promise.all([
      fetch("/api/players"),
      fetch("/api/player-links"),
    ])
    if (playersRes.ok) setPlayers(await playersRes.json())
    if (linksRes.ok) setLinks(await linksRes.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const linkPlayer = useCallback(async () => {
    if (!linkingPlayerId || !cognitoSubInput.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/player-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cognitoSub: cognitoSubInput.trim(), playerId: linkingPlayerId }),
      })
      if (res.ok) {
        setLinkingPlayerId(null)
        setCognitoSubInput("")
        await load()
      }
    } finally {
      setSubmitting(false)
    }
  }, [linkingPlayerId, cognitoSubInput, submitting, load])

  const unlinkPlayer = useCallback(async (cognitoSub: string) => {
    await fetch(`/api/player-links/${cognitoSub}`, { method: "DELETE" })
    await load()
  }, [load])

  if (loading) {
    return <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin" />
  }

  const linkedPlayerIds = new Set(links.map(l => l.playerId))

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/50">
        Link each player&apos;s Cognito account to their roster entry. Players can find their account ID by visiting{" "}
        <span className="text-white/70 font-mono">/live/me</span> while logged in.
      </p>

      <div className="flex flex-col gap-2">
        {players.filter(p => p.team === "VOID" && p.is_active).map(player => {
          const link = links.find(l => l.playerId === player.id)
          const isLinking = linkingPlayerId === player.id

          return (
            <div
              key={player.id}
              className="flex flex-col gap-2 px-4 py-3 rounded-lg border border-white/10"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">#{player.number} {player.first_name} {player.last_name}</span>
                  {link && (
                    <p className="text-xs text-white/40 font-mono mt-0.5 truncate max-w-xs">{link.cognitoSub}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {link ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400/60 hover:text-red-400"
                      onClick={() => unlinkPlayer(link.cognitoSub)}
                    >
                      Unlink
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLinkingPlayerId(isLinking ? null : player.id)}
                    >
                      {isLinking ? "Cancel" : "Link Account"}
                    </Button>
                  )}
                </div>
              </div>

              {isLinking && (
                <div className="flex gap-2 mt-1">
                  <input
                    value={cognitoSubInput}
                    onChange={e => setCognitoSubInput(e.target.value)}
                    placeholder="Paste Cognito sub ID from player's /live/me page"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 font-mono"
                  />
                  <Button size="sm" onClick={linkPlayer} disabled={!cognitoSubInput.trim() || submitting}>
                    {submitting ? "Saving…" : "Save"}
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
