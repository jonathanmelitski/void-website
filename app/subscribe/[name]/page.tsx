"use client"

import { useState } from "react"
import { useParams } from "next/navigation"

export default function SubscribePage() {
  const { name } = useParams<{ name: string }>()
  const listName = decodeURIComponent(name)

  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "already" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus("loading")
    setErrorMsg("")

    try {
      const res = await fetch(`/api/subscribe/${encodeURIComponent(listName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()

      if (res.ok) {
        setStatus("success")
      } else if (res.status === 409 && data.error === "already_subscribed") {
        setStatus("already")
      } else if (res.status === 404) {
        setStatus("error")
        setErrorMsg("This subscription link is no longer active.")
      } else {
        setStatus("error")
        setErrorMsg(data.error ?? "Something went wrong. Please try again.")
      }
    } catch {
      setStatus("error")
      setErrorMsg("Something went wrong. Please try again.")
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-6">

        {/* Logo / brand mark */}
        <div className="flex flex-col gap-1">
          <p className="text-fg-muted text-xs uppercase tracking-widest font-medium">Void Ultimate</p>
          <h1 className="text-2xl font-display leading-none tracking-wide text-foreground">Stay in the loop.</h1>
          <p className="text-fg-muted text-sm mt-1">
            Subscribe to <span className="text-fg-secondary">{listName}</span> for updates.
          </p>
        </div>

        {status === "success" ? (
          <div className="bg-success/10 border border-success/20 rounded-xl px-5 py-4">
            <p className="text-success font-semibold text-sm">You&apos;re subscribed!</p>
            <p className="text-success/60 text-xs mt-1">
              We&apos;ll be in touch at <span className="font-mono">{email}</span>.
            </p>
          </div>
        ) : status === "already" ? (
          <div className="bg-surface border border-border rounded-xl px-5 py-4">
            <p className="text-fg-secondary font-semibold text-sm">Already subscribed</p>
            <p className="text-fg-muted text-xs mt-1">
              <span className="font-mono">{email}</span> is already on this list.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={status === "loading"}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder-white/25 focus:border-border-strong disabled:opacity-50 transition-colors"
            />

            {status === "error" && (
              <p className="text-destructive text-xs">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === "loading" || !email.trim()}
              className="w-full py-3 bg-foreground text-background text-sm font-semibold rounded-xl hover:bg-foreground/90 transition-colors disabled:opacity-40"
            >
              {status === "loading" ? "Subscribing…" : "Subscribe"}
            </button>
          </form>
        )}

        <p className="text-fg-faint text-xs">
          You can unsubscribe at any time via the link in any email we send.
        </p>
      </div>
    </div>
  )
}
