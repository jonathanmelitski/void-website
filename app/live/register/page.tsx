"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function RegisterPage() {
  const [email, setEmail] = useState("")
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
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Registration failed"); return }
      router.push(`/live/confirm?email=${encodeURIComponent(email)}`)
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
          <h1 className="text-4xl font-display leading-none tracking-wide">Create account</h1>
          <p className="text-fg-muted mt-1 text-sm">Join Void Live.</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-fg-secondary">Email</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@upenn.edu" required autoComplete="email"
              className="bg-surface border-border text-foreground placeholder:text-fg-faint" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-fg-secondary">Password</Label>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required autoComplete="new-password"
              className="bg-surface border-border text-foreground placeholder:text-fg-faint" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm" className="text-fg-secondary">Confirm password</Label>
            <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••" required autoComplete="new-password"
              className="bg-surface border-border text-foreground placeholder:text-fg-faint" />
          </div>
          <Button type="submit" disabled={isLoading} className="mt-1">
            {isLoading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <Link href="/live/login" className="text-sm text-fg-muted hover:text-foreground transition-colors">
          Already have an account? Sign in
        </Link>
      </div>
    </div>
  )
}
