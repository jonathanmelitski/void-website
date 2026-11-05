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
      <p className="text-sm text-fg-muted">Sign in to upload photos and manage events.</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vl-email" className="text-fg-secondary">Email</Label>
          <Input
            id="vl-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="bg-surface border-border text-foreground placeholder:text-fg-faint"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vl-password" className="text-fg-secondary">Password</Label>
          <Input
            id="vl-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
            className="bg-surface border-border text-foreground placeholder:text-fg-faint"
          />
        </div>
        <Button type="submit" disabled={isLoading} className="mt-1">
          {isLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="flex gap-4 text-xs text-fg-muted">
        <Link href="/live/register" className="hover:text-foreground transition-colors">Create account</Link>
        <Link href="/live/reset-password" className="hover:text-foreground transition-colors">Forgot password?</Link>
      </div>
    </div>
  )
}
