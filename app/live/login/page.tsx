"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { refreshAuth } = useAuth()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Login failed"); return }
      await refreshAuth()
      router.push("/live/dashboard")
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
          <h1 className="text-4xl font-black">Void Live</h1>
          <p className="text-white/50 mt-1 text-sm">Sign in to manage events and photos.</p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-white/70">Email</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@upenn.edu" required autoComplete="email"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-white/70">Password</Label>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required autoComplete="current-password"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
          </div>
          <Button type="submit" disabled={isLoading} className="mt-1">
            {isLoading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="flex gap-5 text-sm text-white/40">
          <Link href="/live/register" className="hover:text-white transition-colors">Create account</Link>
          <Link href="/live/reset-password" className="hover:text-white transition-colors">Forgot password?</Link>
        </div>
      </div>
    </div>
  )
}
