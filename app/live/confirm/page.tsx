"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function ConfirmForm() {
  const searchParams = useSearchParams()
  const email = searchParams.get("email") ?? ""
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Confirmation failed"); return }
      router.push("/live/login")
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  async function handleResend() {
    setError("")
    const res = await fetch("/api/auth/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, resend: true }),
    })
    setNotice(res.ok ? "Code resent — check your email." : "Failed to resend.")
  }

  return (
    <div className="flex flex-col items-center pt-24 px-4 text-left">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-black">Check your email</h1>
          <p className="text-white/50 mt-1 text-sm">Enter the 6-digit code sent to {email}.</p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-white/60">{notice}</p>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code" className="text-white/70">Confirmation code</Label>
            <Input id="code" type="text" value={code} onChange={e => setCode(e.target.value)}
              placeholder="123456" required maxLength={6} autoComplete="one-time-code"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 tracking-widest text-center text-lg" />
          </div>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Confirming…" : "Confirm account"}
          </Button>
        </form>

        <div className="flex gap-5 text-sm text-white/40">
          <button type="button" onClick={handleResend} className="hover:text-white transition-colors">Resend code</button>
          <Link href="/live/login" className="hover:text-white transition-colors">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}

export default function ConfirmPage() {
  return <Suspense><ConfirmForm /></Suspense>
}
