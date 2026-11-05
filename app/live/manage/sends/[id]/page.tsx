"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useRequireAuth } from "@/hooks/use-require-auth"
import { apiFetch } from "@/lib/api-fetch"
import { useUserEmails } from "../../use-user-emails"
import { PersonName } from "../../person-name"

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

/** host + path, without protocol or query noise */
function shortUrl(url: string) {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`
  } catch {
    return url
  }
}

function BackLink() {
  return (
    <Button asChild variant="quiet" size="sm" className="mb-3 self-start">
      <Link href="/live/manage?tab=marketing">
        <ChevronLeft aria-hidden />
        Marketing
      </Link>
    </Button>
  )
}

export default function SendStatsPage() {
  const { id } = useParams<{ id: string }>()
  const { isLoading: authLoading } = useRequireAuth({ roles: ["ADMIN"], forbiddenHref: "/live/manage" })
  const userEmails = useUserEmails()

  const [send, setSend] = useState<SendRecord | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [statsError, setStatsError] = useState("")

  useEffect(() => {
    if (!id) return
    Promise.all([
      apiFetch(`/api/marketing/sends/${id}`).then(r => r.ok ? r.json() : null),
      apiFetch(`/api/marketing/sends/${id}/stats`).then(async r => ({ ok: r.ok, data: r.ok ? await r.json() : null })),
    ]).then(([sendData, statsResult]) => {
      if (!sendData) { setError("This send couldn't be found. It may have been deleted."); return }
      setSend(sendData)
      if (statsResult.ok) {
        setStats(statsResult.data)
      } else {
        setStatsError("Couldn't load open and click stats. Reload to try again.")
      }
    }).catch(() => setError("Couldn't load this send. Check your connection and try again."))
      .finally(() => setLoading(false))
  }, [id])

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh] p-8">
        <Spinner size="md" />
      </div>
    )
  }

  if (error || !send) {
    return (
      <div className="flex flex-col px-4 py-6 text-left sm:p-8 lg:px-16">
        <BackLink />
        <p className="text-destructive">{error || "This send couldn't be found."}</p>
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

  const cards = stats ? [
    { value: String(stats.recipientCount), label: "Sent" },
    { value: String(stats.uniqueOpens), label: `Opened · ${pct(stats.uniqueOpens, stats.recipientCount)}` },
    { value: String(stats.uniqueClicks), label: `Clicked · ${pct(stats.uniqueClicks, stats.recipientCount)}` },
    { value: pct(stats.uniqueClicks, stats.uniqueOpens), label: "Click-to-open" },
    { value: String(stats.totalClickEvents), label: "Total clicks" },
  ] : []

  return (
    <div className="flex flex-col gap-8 px-4 py-6 text-left sm:p-8 lg:px-16">
      {/* Header */}
      <div className="flex flex-col">
        <BackLink />
        <h1 className="text-3xl font-display leading-none tracking-wide">
          {send.newsletterTitle}
          {send.sendMode === "test" && (
            <span className="ml-2 font-sans text-xs bg-warning/10 text-warning border border-warning/30 px-2 py-1 rounded-full align-middle tracking-normal">Test</span>
          )}
        </h1>
        <p className="text-fg-muted text-sm mt-2">
          {send.sendMode === "test" ? "Test send" : send.listName} · {sentDate} · by <PersonName id={send.sentBy} lookup={userEmails} />
        </p>
      </div>

      {!send.trackingEnabled ? (
        <p className="text-fg-muted text-sm">Tracking was off for this send, so there are no open or click stats.</p>
      ) : statsError ? (
        <p className="text-destructive text-sm">{statsError}</p>
      ) : !stats ? (
        <p className="text-fg-muted text-sm">Stats aren&apos;t available for this send.</p>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            {cards.map(c => (
              <div key={c.label} className="bg-surface border border-border rounded-xl px-4 py-4 sm:px-5">
                <p className="text-3xl font-bold tabular-nums">{c.value}</p>
                <p className="text-xs text-fg-muted mt-1">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Per-link bar chart */}
          {allLinks.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-bold">Link clicks</h2>
              {maxTotalClicks === 0 ? (
                <p className="text-sm text-fg-muted">No clicks yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {allLinks.map(link => {
                    const barPct = (link.totalClicks / maxTotalClicks) * 100
                    return (
                      <div key={link.url} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-4">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link.url}
                            className="text-sm text-fg-secondary hover:text-foreground truncate transition-colors min-w-0"
                          >
                            {shortUrl(link.url)}
                          </a>
                          <span className="text-xs text-fg-muted shrink-0 tabular-nums">
                            {link.uniqueClicks} unique · {link.totalClicks} total
                          </span>
                        </div>
                        <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand/60 rounded-full transition-all duration-300"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
