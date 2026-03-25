"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Request failed"); return }
      router.push(`/live/confirm-reset?email=${encodeURIComponent(email)}`)
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center pt-24 px-4 text-left">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-black">Reset password</h1>
          <p className="text-white/50 mt-1 text-sm">We&apos;ll send a reset code to your email.</p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-white/70">Email</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@upenn.edu" required autoComplete="email"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
          </div>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Sending…" : "Send reset code"}
          </Button>
        </form>

        <Link href="/live/login" className="text-sm text-white/40 hover:text-white transition-colors">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
