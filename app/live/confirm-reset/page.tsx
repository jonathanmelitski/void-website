"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function ConfirmResetForm() {
  const searchParams = useSearchParams()
  const email = searchParams.get("email") ?? ""
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password !== confirm) { setError("Passwords do not match"); return }
    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/confirm-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Reset failed"); return }
      router.push("/live/login")
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
          <h1 className="text-4xl font-black">Set new password</h1>
          <p className="text-white/50 mt-1 text-sm">Enter the code sent to {email}.</p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code" className="text-white/70">Reset code</Label>
            <Input id="code" type="text" value={code} onChange={e => setCode(e.target.value)}
              placeholder="123456" required maxLength={6} autoComplete="one-time-code"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 tracking-widest text-center text-lg" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-white/70">New password</Label>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required autoComplete="new-password"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm" className="text-white/70">Confirm new password</Label>
            <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••" required autoComplete="new-password"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
          </div>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Resetting…" : "Reset password"}
          </Button>
        </form>

        <Link href="/live/login" className="text-sm text-white/40 hover:text-white transition-colors">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}

export default function ConfirmResetPage() {
  return <Suspense><ConfirmResetForm /></Suspense>
}
