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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-6">

        {/* Logo / brand mark */}
        <div className="flex flex-col gap-1">
          <p className="text-white/30 text-xs uppercase tracking-widest font-medium">Void Ultimate</p>
          <h1 className="text-2xl font-black text-white">Stay in the loop.</h1>
          <p className="text-white/40 text-sm mt-1">
            Subscribe to <span className="text-white/60">{listName}</span> for updates.
          </p>
        </div>

        {status === "success" ? (
          <div className="bg-green-400/10 border border-green-400/20 rounded-xl px-5 py-4">
            <p className="text-green-400 font-semibold text-sm">You&apos;re subscribed!</p>
            <p className="text-green-400/60 text-xs mt-1">
              We&apos;ll be in touch at <span className="font-mono">{email}</span>.
            </p>
          </div>
        ) : status === "already" ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-4">
            <p className="text-white/70 font-semibold text-sm">Already subscribed</p>
            <p className="text-white/40 text-xs mt-1">
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/30 disabled:opacity-50 transition-colors"
            />

            {status === "error" && (
              <p className="text-red-400 text-xs">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === "loading" || !email.trim()}
              className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40"
            >
              {status === "loading" ? "Subscribing…" : "Subscribe"}
            </button>
          </form>
        )}

        <p className="text-white/20 text-xs">
          You can unsubscribe at any time via the link in any email we send.
        </p>
      </div>
    </div>
  )
}
