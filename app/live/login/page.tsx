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

  // NEW_PASSWORD_REQUIRED challenge state
  const [challenge, setChallenge] = useState<{ session: string; email: string } | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const { refreshAuth } = useAuth()
  const router = useRouter()

  async function handleSignIn(e: React.FormEvent) {
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

      if (data.challenge === "NEW_PASSWORD_REQUIRED") {
        setChallenge({ session: data.session, email: data.email })
        return
      }

      await refreshAuth()
      router.push("/live")
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match")
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: challenge!.email, session: challenge!.session, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to set password"); return }
      await refreshAuth()
      router.push("/live")
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  if (challenge) {
    return (
      <div className="flex flex-col items-center pt-24 px-4 text-left">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div>
            <h1 className="text-4xl font-black">Set your password</h1>
            <p className="text-white/50 mt-1 text-sm">Choose a permanent password to continue.</p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <form onSubmit={handleSetPassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password" className="text-white/70">New password</Label>
              <Input id="new-password" type="password" value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="••••••••" required autoComplete="new-password"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password" className="text-white/70">Confirm password</Label>
              <Input id="confirm-password" type="password" value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••" required autoComplete="new-password"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
            </div>
            <Button type="submit" disabled={isLoading} className="mt-1">
              {isLoading ? "Saving…" : "Set password & sign in"}
            </Button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center pt-24 px-4 text-left">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-black">Void Live</h1>
          <p className="text-white/50 mt-1 text-sm">Sign in to manage events and photos.</p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <form onSubmit={handleSignIn} className="flex flex-col gap-4">
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

        <Link href="/live/reset-password" className="text-sm text-white/40 hover:text-white transition-colors w-fit">
          Forgot password?
        </Link>
      </div>
    </div>
  )
}
