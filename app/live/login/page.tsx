"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/use-auth"
import { safeNextPath } from "@/hooks/use-require-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { PageContainer } from "@/components/ui/page"
import { FormMessage, PasswordInput, postAuth } from "@/components/auth/auth-form"
import { PASSWORD_RULES } from "@/lib/auth-errors"

// After sign-in go to ?next= (same-origin paths only), else /live.
// Read from window.location so it's current at the moment of redirect.
function nextPath() {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"))
}

const NOTICES: Record<string, string> = {
  confirmed: "Account confirmed. Sign in to continue.",
  reset: "Password updated. Sign in with your new password.",
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(searchParams.get("email") ?? "")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [notice] = useState(NOTICES[searchParams.get("notice") ?? ""] ?? "")
  const [isLoading, setIsLoading] = useState(false)

  // NEW_PASSWORD_REQUIRED challenge state
  const [challenge, setChallenge] = useState<{ session: string; email: string } | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [mismatch, setMismatch] = useState(false)

  const { reportSignedIn, status } = useAuth()
  const router = useRouter()

  // Already signed in (e.g. opened a login link in another tab): go straight on.
  useEffect(() => {
    if (status === "authenticated") router.replace(nextPath())
  }, [status, router])

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      const res = await postAuth("/api/auth/login", { email, password })
      if (!res.ok) {
        if (res.code === "UNCONFIRMED") {
          // Send a fresh code (the one from sign-up may have expired), then finish on the confirm screen
          await postAuth("/api/auth/confirm", { email, resend: true })
          router.push(`/live/confirm?email=${encodeURIComponent(email)}&sent=1`)
          return
        }
        if (res.code === "RESET_REQUIRED") {
          router.push(`/live/reset-password?email=${encodeURIComponent(email)}`)
          return
        }
        setError(res.error)
        return
      }

      if (res.data.challenge === "NEW_PASSWORD_REQUIRED") {
        setChallenge({ session: String(res.data.session), email: String(res.data.email ?? email) })
        return
      }

      await reportSignedIn()
      router.replace(nextPath())
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (newPassword !== confirmPassword) {
      setMismatch(true)
      return
    }
    setIsLoading(true)
    try {
      const res = await postAuth("/api/auth/challenge", { email: challenge!.email, session: challenge!.session, newPassword })
      if (!res.ok) {
        if (res.code === "SESSION_EXPIRED") {
          // The challenge session lasts a few minutes; start over from the sign-in form
          setChallenge(null)
          setPassword("")
        }
        setError(res.error)
        return
      }
      await reportSignedIn()
      router.replace(nextPath())
    } finally {
      setIsLoading(false)
    }
  }

  if (challenge) {
    return (
      <PageContainer width="form" className="flex flex-col gap-6 text-left">
        <div>
          <h1 className="text-4xl font-display leading-none tracking-wide">Set your password</h1>
          <p className="text-fg-muted mt-2 text-sm">Choose a permanent password for {challenge.email}.</p>
        </div>

        <form onSubmit={handleSetPassword} className="flex flex-col gap-4">
          <Field label="New password" hint={PASSWORD_RULES}>
            <PasswordInput id="new-password" value={newPassword}
              onChange={e => { setNewPassword(e.target.value); setMismatch(false) }}
              required autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" error={mismatch ? "Passwords don't match." : undefined}>
            <PasswordInput id="confirm-password" value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setMismatch(false) }}
              required autoComplete="new-password" />
          </Field>
          <FormMessage error={error} />
          <Button type="submit" size="lg" loading={isLoading}>
            {isLoading ? "Saving…" : "Set password and sign in"}
          </Button>
        </form>

        <Button
          type="button"
          variant="quiet"
          className="w-fit"
          onClick={() => { setChallenge(null); setError(""); setPassword(""); setNewPassword(""); setConfirmPassword("") }}
        >
          Use a different account
        </Button>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="form" className="flex flex-col gap-6 text-left">
      <div>
        <h1 className="text-4xl font-display leading-none tracking-wide">Sign in</h1>
        <p className="text-fg-muted mt-2 text-sm">Void Live: live scoring, film and your game footage.</p>
      </div>

      <form onSubmit={handleSignIn} className="flex flex-col gap-4">
        <Field label="Email">
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@upenn.edu" required autoComplete="email" className="h-10" />
        </Field>
        <Field label="Password">
          <PasswordInput id="password" value={password} onChange={e => setPassword(e.target.value)}
            required autoComplete="current-password" autoFocus={!!notice} />
        </Field>
        <FormMessage error={error} notice={notice} />
        <Button type="submit" size="lg" loading={isLoading}>
          {isLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link
          href={email ? `/live/reset-password?email=${encodeURIComponent(email)}` : "/live/reset-password"}
          className="text-fg-muted hover:text-foreground transition-colors"
        >
          Forgot password?
        </Link>
        <Link href="/live/register" className="text-fg-muted hover:text-foreground transition-colors">
          Create account
        </Link>
      </div>
    </PageContainer>
  )
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
