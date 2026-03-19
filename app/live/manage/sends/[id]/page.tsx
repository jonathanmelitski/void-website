"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAuth } from "@/lib/use-auth"

type StatsResponse = {
  sendId: string
  recipientCount: number
  trackedLinks: string[]
  uniqueOpens: number
  uniqueClicks: number
  totalClickEvents: number
  linkStats: { url: string; uniqueClicks: number; totalClicks: number }[]
}

type SendRecord = {
  id: string
  newsletterTitle: string
  listName: string
  sendMode?: "list" | "test"
  sentAt: string
  sentBy: string
  recipientCount: number
  trackingEnabled?: boolean
}

function pct(n: number, total: number) {
  if (total === 0) return "—"
  return `${Math.round((n / total) * 100)}%`
}

export default function SendStatsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()

  const [send, setSend] = useState<SendRecord | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [statsError, setStatsError] = useState("")

  const isAdmin = user?.groups.includes("ADMIN") ?? false

  useEffect(() => {
    if (!authLoading && !user) router.replace("/live/login")
  }, [user, authLoading, router])

  useEffect(() => {
    if (!authLoading && user && !isAdmin) router.replace("/live/manage")
  }, [user, authLoading, isAdmin, router])

  useEffect(() => {
    if (!id) return
    Promise.all([
      fetch(`/api/marketing/sends/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/marketing/sends/${id}/stats`).then(r => r.json().then(d => ({ ok: r.ok, status: r.status, data: d }))),
    ]).then(([sendData, statsResult]) => {
      if (!sendData) { setError("Send not found"); return }
      setSend(sendData)
      if (statsResult.ok) {
        setStats(statsResult.data)
      } else {
        setStatsError(`Stats error ${statsResult.status}: ${statsResult.data?.error ?? "unknown"}`)
      }
    }).catch(e => setError(`Failed to load: ${e?.message ?? e}`)).finally(() => setLoading(false))
  }, [id])

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !send) {
    return (
      <div className="p-8 lg:px-16">
        <p className="text-red-400">{error || "Send not found"}</p>
      </div>
    )
  }

  const sentDate = new Date(send.sentAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  })

  // Build full link list: tracked links + any in linkStats not in trackedLinks
  const allLinks = stats ? (() => {
    const tracked = send.trackingEnabled ? (stats.trackedLinks ?? []) : []
    const statsMap = new Map(stats.linkStats.map(l => [l.url, l]))
    // merge: all tracked links, plus any clicked links not in trackedLinks
    const urls = new Set([...tracked, ...stats.linkStats.map(l => l.url)])
    return Array.from(urls).map(url => ({
      url,
      uniqueClicks: statsMap.get(url)?.uniqueClicks ?? 0,
      totalClicks: statsMap.get(url)?.totalClicks ?? 0,
    })).sort((a, b) => b.totalClicks - a.totalClicks)
  })() : []

  const maxTotalClicks = allLinks.reduce((m, l) => Math.max(m, l.totalClicks), 0)

  return (
    <div className="flex flex-col p-8 lg:px-16 gap-8">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push("/live/manage?tab=marketing")}
          className="text-white/40 hover:text-white/70 text-sm mb-4 flex items-center gap-1 transition-colors"
        >
          ← Marketing
        </button>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-black">
            {send.newsletterTitle}
            {send.sendMode === "test" && (
              <span className="ml-2 text-xs bg-yellow-400/10 text-yellow-400 border border-yellow-400/30 px-2 py-1 rounded-full align-middle">Test</span>
            )}
          </h1>
          <p className="text-white/40 text-sm">
            {send.sendMode === "test" ? "Test send" : send.listName} &bull; {sentDate} &bull; by {send.sentBy}
          </p>
        </div>
      </div>

      {!send.trackingEnabled ? (
        <p className="text-white/40 text-sm">Tracking was not enabled for this send.</p>
      ) : statsError ? (
        <p className="text-red-400 text-sm font-mono">{statsError}</p>
      ) : !stats ? (
        <p className="text-white/40 text-sm">Stats unavailable.</p>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 text-center">
              <p className="text-3xl font-bold">{stats.recipientCount}</p>
              <p className="text-xs text-white/40 mt-1">Sent</p>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 text-center">
              <p className="text-3xl font-bold">{stats.uniqueOpens}</p>
              <p className="text-xs text-white/40 mt-1">
                Opened &bull; {pct(stats.uniqueOpens, stats.recipientCount)}
              </p>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 text-center">
              <p className="text-3xl font-bold">{stats.uniqueClicks}</p>
              <p className="text-xs text-white/40 mt-1">
                Clicked &bull; {pct(stats.uniqueClicks, stats.recipientCount)}
              </p>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 text-center">
              <p className="text-3xl font-bold">{pct(stats.uniqueClicks, stats.uniqueOpens)}</p>
              <p className="text-xs text-white/40 mt-1">Click-to-open</p>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 text-center">
              <p className="text-3xl font-bold">{stats.totalClickEvents}</p>
              <p className="text-xs text-white/40 mt-1">Total clicks</p>
            </div>
          </div>

          {/* Per-link bar chart */}
          {allLinks.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Link clicks</h2>
              <div className="flex flex-col gap-2">
                {allLinks.map(link => {
                  const barPct = maxTotalClicks > 0 ? (link.totalClicks / maxTotalClicks) * 100 : 0
                  return (
                    <div key={link.url} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-4">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-white/50 hover:text-white/80 font-mono truncate transition-colors min-w-0"
                        >
                          {link.url}
                        </a>
                        <span className="text-xs text-white/40 shrink-0">
                          {link.uniqueClicks} unique &middot; {link.totalClicks} total
                        </span>
                      </div>
                      <div className="w-full h-2 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-white/30 rounded-full transition-all duration-300"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
