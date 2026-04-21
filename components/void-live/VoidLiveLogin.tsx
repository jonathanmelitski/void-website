"use client"

import { useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function VoidLiveLogin() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { refreshAuth } = useAuth()

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
      if (!res.ok) {
        setError(data.error ?? "Login failed")
        return
      }
      await refreshAuth()
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="px-6 py-5 flex flex-col gap-4 max-w-sm">
      <p className="text-sm text-white/50">Sign in to upload photos and manage events.</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vl-email" className="text-white/70">Email</Label>
          <Input
            id="vl-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vl-password" className="text-white/70">Password</Label>
          <Input
            id="vl-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
            className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
          />
        </div>
        <Button type="submit" disabled={isLoading} className="mt-1">
          {isLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="flex gap-4 text-xs text-white/30">
        <Link href="/live/register" className="hover:text-white/60 transition-colors">Create account</Link>
        <Link href="/live/reset-password" className="hover:text-white/60 transition-colors">Forgot password?</Link>
      </div>
    </div>
  )
}
