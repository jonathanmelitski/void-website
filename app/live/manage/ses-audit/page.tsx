"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useRequireAuth } from "@/hooks/use-require-auth"
import { apiFetch } from "@/lib/api-fetch"

type DailyMetrics = {
  date: string
  sent: number
  delivered: number
  bounced: number
  complained: number
  rejected: number
}

type SuppressedEmail = {
  email: string
  reason: "BOUNCE" | "COMPLAINT"
  lastUpdated: string
}

type AccountInfo = {
  sendingEnabled: boolean
  productionAccess: boolean
  enforcementStatus: string
  error?: string
}

type AuditData = {
  account: AccountInfo
  metrics: DailyMetrics[]
  suppressed: SuppressedEmail[]
}

const REASON_LABEL: Record<SuppressedEmail["reason"], string> = { BOUNCE: "Bounce", COMPLAINT: "Complaint" }

function ReasonBadge({ reason }: { reason: SuppressedEmail["reason"] }) {
  return (
    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
      reason === "COMPLAINT" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
    }`}>
      {REASON_LABEL[reason] ?? reason}
    </span>
  )
}

export default function SesAuditPage() {
  const { isLoading: authLoading } = useRequireAuth({ roles: ["ADMIN"], forbiddenHref: "/live/manage" })
  const [data, setData] = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [suppressedFilter, setSuppressedFilter] = useState("")
  const [reasonFilter, setReasonFilter] = useState<"ALL" | "BOUNCE" | "COMPLAINT">("ALL")

  useEffect(() => {
    apiFetch("/api/marketing/ses-audit")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(() => setError("Couldn't load SES data. Reload to try again."))
      .finally(() => setLoading(false))
  }, [])

  const totalSent = data?.metrics.reduce((s, d) => s + d.sent, 0) ?? 0
  const totalBounced = data?.metrics.reduce((s, d) => s + d.bounced, 0) ?? 0
  const totalComplained = data?.metrics.reduce((s, d) => s + d.complained, 0) ?? 0
  const maxSent = Math.max(...(data?.metrics.map(d => d.sent) ?? [1]), 1)

  const filteredSuppressed = (data?.suppressed ?? []).filter(s => {
    if (reasonFilter !== "ALL" && s.reason !== reasonFilter) return false
    if (suppressedFilter && !s.email.toLowerCase().includes(suppressedFilter.toLowerCase())) return false
    return true
  })

  if (loading || authLoading) {
    return (
      <div className="min-h-[50dvh] flex items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 text-left text-foreground sm:p-8">

      {/* Header */}
      <div className="flex flex-col">
        <Button asChild variant="quiet" size="sm" className="mb-3 self-start">
          <Link href="/live/manage?tab=marketing">
            <ChevronLeft aria-hidden />
            Marketing
          </Link>
        </Button>
        <h1 className="text-3xl font-display leading-none tracking-wide">SES audit</h1>
        <p className="text-fg-muted text-sm mt-1">Live data from Amazon SES, not from our database</p>
      </div>

      {error && (
        <div role="alert" className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Account status */}
      {data?.account && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Account</h2>
          {'error' in data.account && data.account.error ? (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-destructive">Couldn&apos;t read the SES account status.</p>
              <details className="text-fg-muted">
                <summary className="cursor-pointer">Technical details</summary>
                <p className="mt-1 font-mono text-xs break-all">{data.account.error}</p>
              </details>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: "Sending", value: data.account.sendingEnabled ? "Enabled" : "Disabled", ok: data.account.sendingEnabled },
                { label: "Production access", value: data.account.productionAccess ? "Yes" : "Sandbox", ok: data.account.productionAccess },
                { label: "Enforcement status", value: data.account.enforcementStatus, ok: data.account.enforcementStatus === "HEALTHY" || data.account.enforcementStatus === "UNKNOWN" },
              ].map(({ label, value, ok }) => (
                <div key={label} className="bg-surface border border-border rounded-xl px-4 py-3">
                  <p className="text-fg-muted text-xs mb-1">{label}</p>
                  <p className={`text-sm font-medium ${ok ? "text-foreground" : "text-destructive"}`}>{value}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 30-day summary stats */}
      {data && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Last 30 days</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Sent", value: totalSent.toLocaleString(), color: "text-foreground" },
              { label: "Bounced", value: totalBounced.toLocaleString(), pct: totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) + "%" : null, color: totalBounced > 0 ? "text-warning" : "text-foreground" },
              { label: "Complained", value: totalComplained.toLocaleString(), pct: totalSent > 0 ? ((totalComplained / totalSent) * 100).toFixed(2) + "%" : null, color: totalComplained > 0 ? "text-destructive" : "text-foreground" },
            ].map(({ label, value, pct, color }) => (
              <div key={label} className="bg-surface border border-border rounded-xl px-3 py-3 sm:px-4">
                <p className="text-fg-muted text-xs mb-1">{label}</p>
                <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
                {pct && <p className="text-fg-muted text-xs">{pct} rate</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Daily bar chart */}
      {data && data.metrics.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Daily sends</h2>
          <div className="bg-surface border border-border rounded-xl p-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="text-fg-muted border-b border-border">
                  <th className="text-left pb-2 pr-4 font-medium w-28">Date</th>
                  <th className="text-left pb-2 pr-3 font-medium w-16">Sent</th>
                  <th className="pb-2 pr-3 font-medium text-left">Volume</th>
                  <th className="text-left pb-2 pr-3 font-medium w-20">Delivered</th>
                  <th className="text-left pb-2 pr-3 font-medium w-16">Bounced</th>
                  <th className="text-left pb-2 font-medium w-20">Complained</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.map(row => (
                  <tr key={row.date} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-4 text-fg-muted tabular-nums">{row.date}</td>
                    <td className="py-1.5 pr-3 text-foreground tabular-nums">{row.sent > 0 ? row.sent.toLocaleString() : <span className="text-fg-muted">—</span>}</td>
                    <td className="py-1.5 pr-3">
                      <div className="w-full min-w-24 max-w-48 h-2 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand/60 rounded-full"
                          style={{ width: `${(row.sent / maxSent) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-fg-muted tabular-nums">{row.delivered > 0 ? row.delivered : "—"}</td>
                    <td className={`py-1.5 pr-3 tabular-nums ${row.bounced > 0 ? "text-warning" : "text-fg-muted"}`}>{row.bounced > 0 ? row.bounced : "—"}</td>
                    <td className={`py-1.5 tabular-nums ${row.complained > 0 ? "text-destructive" : "text-fg-muted"}`}>{row.complained > 0 ? row.complained : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && data.metrics.length === 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-fg-muted">No sending stats yet.</p>
          <details className="text-fg-muted">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-1 text-xs">
              If emails have gone out, the server role may be missing the{" "}
              <code className="bg-surface px-1 rounded-md">cloudwatch:GetMetricData</code> permission.
            </p>
          </details>
        </div>
      )}

      {/* Suppression list */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Suppression list</h2>
            <p className="text-fg-muted text-sm mt-0.5">Addresses SES won&apos;t deliver to after a bounce or complaint</p>
          </div>
          <span className="text-fg-muted text-sm">{data?.suppressed.length ?? 0} total</span>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="search"
            aria-label="Filter by email"
            placeholder="Filter by email"
            value={suppressedFilter}
            onChange={e => setSuppressedFilter(e.target.value)}
            className="h-10 sm:h-9 sm:flex-1"
          />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Reason">
            {(["ALL", "BOUNCE", "COMPLAINT"] as const).map(r => (
              <Button
                key={r}
                size="sm"
                variant={reasonFilter === r ? "secondary" : "ghost"}
                aria-pressed={reasonFilter === r}
                className="h-10 sm:h-9"
                onClick={() => setReasonFilter(r)}
              >
                {r === "ALL" ? "All" : r === "BOUNCE" ? "Bounces" : "Complaints"}
              </Button>
            ))}
          </div>
        </div>

        {filteredSuppressed.length === 0 ? (
          <p className="text-fg-muted text-sm">{data?.suppressed.length === 0 ? "No suppressed addresses." : "No addresses match this filter."}</p>
        ) : (
          <>
            {/* Phones: one card per address */}
            <ul className="flex flex-col gap-2 sm:hidden">
              {filteredSuppressed.map(s => (
                <li key={s.email} className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-all font-mono text-sm text-fg-secondary">{s.email}</span>
                    <ReasonBadge reason={s.reason} />
                  </div>
                  <span className="text-xs text-fg-muted">
                    {s.lastUpdated ? new Date(s.lastUpdated).toLocaleString() : "—"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block bg-surface border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg-muted text-xs border-b border-border">
                    <th className="text-left px-4 py-2.5 font-medium">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium">Reason</th>
                    <th className="text-left px-4 py-2.5 font-medium">Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppressed.map(s => (
                    <tr key={s.email} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 text-left text-fg-secondary font-mono text-xs">{s.email}</td>
                      <td className="px-4 py-2.5 text-left"><ReasonBadge reason={s.reason} /></td>
                      <td className="px-4 py-2.5 text-left text-fg-muted text-xs tabular-nums">
                        {s.lastUpdated ? new Date(s.lastUpdated).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

    </div>
  )
}
