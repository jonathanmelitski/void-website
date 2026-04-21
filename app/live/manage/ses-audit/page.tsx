"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

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

export default function SesAuditPage() {
  const router = useRouter()
  const [data, setData] = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [suppressedFilter, setSuppressedFilter] = useState("")
  const [reasonFilter, setReasonFilter] = useState<"ALL" | "BOUNCE" | "COMPLAINT">("ALL")

  useEffect(() => {
    fetch("/api/marketing/ses-audit")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(err => setError(`Failed to load audit data (${err})`))
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 flex flex-col gap-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/live/manage")}
          className="text-white/30 hover:text-white transition-colors text-sm"
        >
          ← Back
        </button>
        <div>
          <h1 className="text-xl font-bold">SES Audit</h1>
          <p className="text-white/30 text-xs mt-0.5">Live data from AWS — not our database</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Account status */}
      {data?.account && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider">Account</h2>
          {'error' in data.account && data.account.error ? (
            <p className="text-red-400/70 text-sm">{data.account.error}</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Sending", value: data.account.sendingEnabled ? "Enabled" : "Disabled", ok: data.account.sendingEnabled },
                { label: "Production access", value: data.account.productionAccess ? "Yes" : "Sandbox", ok: data.account.productionAccess },
                { label: "Enforcement status", value: data.account.enforcementStatus, ok: data.account.enforcementStatus === "HEALTHY" || data.account.enforcementStatus === "UNKNOWN" },
              ].map(({ label, value, ok }) => (
                <div key={label} className="bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
                  <p className="text-white/30 text-xs mb-1">{label}</p>
                  <p className={`text-sm font-medium ${ok ? "text-white" : "text-red-400"}`}>{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 30-day summary stats */}
      {data && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider">Last 30 days — CloudWatch</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Sent", value: totalSent.toLocaleString(), color: "text-white" },
              { label: "Bounced", value: totalBounced.toLocaleString(), pct: totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) + "%" : null, color: totalBounced > 0 ? "text-yellow-400" : "text-white" },
              { label: "Complained", value: totalComplained.toLocaleString(), pct: totalSent > 0 ? ((totalComplained / totalSent) * 100).toFixed(2) + "%" : null, color: totalComplained > 0 ? "text-red-400" : "text-white" },
            ].map(({ label, value, pct, color }) => (
              <div key={label} className="bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
                <p className="text-white/30 text-xs mb-1">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
                {pct && <p className="text-white/30 text-xs">{pct} rate</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily bar chart */}
      {data && data.metrics.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider">Daily sends — CloudWatch</h2>
          <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/30 border-b border-white/10">
                  <th className="text-left pb-2 pr-4 font-medium w-28">Date</th>
                  <th className="text-left pb-2 pr-3 font-medium w-16">Sent</th>
                  <th className="pb-2 pr-3 font-medium w-48 text-left">Volume</th>
                  <th className="text-left pb-2 pr-3 font-medium w-20">Delivered</th>
                  <th className="text-left pb-2 pr-3 font-medium w-16">Bounced</th>
                  <th className="text-left pb-2 font-medium w-20">Complained</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.map(row => (
                  <tr key={row.date} className="border-b border-white/5 last:border-0">
                    <td className="py-1.5 pr-4 text-white/50 font-mono">{row.date}</td>
                    <td className="py-1.5 pr-3 text-white/80 font-mono">{row.sent > 0 ? row.sent.toLocaleString() : <span className="text-white/20">—</span>}</td>
                    <td className="py-1.5 pr-3">
                      <div className="w-48 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-white/30 rounded-full"
                          style={{ width: `${(row.sent / maxSent) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-white/50 font-mono">{row.delivered > 0 ? row.delivered : <span className="text-white/20">—</span>}</td>
                    <td className={`py-1.5 pr-3 font-mono ${row.bounced > 0 ? "text-yellow-400/70" : "text-white/20"}`}>{row.bounced > 0 ? row.bounced : "—"}</td>
                    <td className={`py-1.5 font-mono ${row.complained > 0 ? "text-red-400/70" : "text-white/20"}`}>{row.complained > 0 ? row.complained : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.metrics.length === 0 && (
        <p className="text-white/30 text-sm">No CloudWatch data — the IAM role may need <code className="bg-white/5 px-1 rounded">cloudwatch:GetMetricData</code> permission.</p>
      )}

      {/* Suppression list */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider">Suppression list</h2>
            <p className="text-white/25 text-xs mt-0.5">Emails SES won't deliver to due to bounce or complaint</p>
          </div>
          <span className="text-white/30 text-xs">{data?.suppressed.length ?? 0} total</span>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Filter by email…"
            value={suppressedFilter}
            onChange={e => setSuppressedFilter(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/30"
          />
          {(["ALL", "BOUNCE", "COMPLAINT"] as const).map(r => (
            <button
              key={r}
              onClick={() => setReasonFilter(r)}
              className={`px-3 py-2 text-xs rounded-lg transition-colors ${
                reasonFilter === r
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/40 hover:text-white hover:bg-white/10"
              }`}
            >
              {r === "ALL" ? "All" : r === "BOUNCE" ? "Bounces" : "Complaints"}
            </button>
          ))}
        </div>

        {filteredSuppressed.length === 0 ? (
          <p className="text-white/30 text-sm">{data?.suppressed.length === 0 ? "No suppressed emails." : "No matches."}</p>
        ) : (
          <div className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/30 text-xs border-b border-white/10">
                  <th className="text-left px-4 py-2.5 font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium">Reason</th>
                  <th className="text-left px-4 py-2.5 font-medium">Last updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppressed.map(s => (
                  <tr key={s.email} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white/70 font-mono text-xs">{s.email}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.reason === "COMPLAINT"
                          ? "bg-red-400/10 text-red-400/80"
                          : "bg-yellow-400/10 text-yellow-400/80"
                      }`}>
                        {s.reason}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-white/30 text-xs font-mono">
                      {s.lastUpdated ? new Date(s.lastUpdated).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
