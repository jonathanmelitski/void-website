"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { authEvents } from "@/lib/api-fetch"
import { useAuth } from "@/lib/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Session UI mounted once by AuthProvider (plain shadcn primitives; restyle freely).
// - expired: sign in again IN PLACE. No navigation, so whatever the user was doing stays on screen,
//   and requests waiting on apiFetch({ waitForSession: true }) continue after sign-in.
// - offline: a small "can't reach the server" notice. Never a sign-out.

// Pages that don't need a session (and the broadcast overlay) never show session UI.
const NO_SESSION_UI = /^\/live\/(login|register|confirm|confirm-reset|reset-password|watch|scoreboard)(\/|$)/

export function SessionStatusUI() {
  const pathname = usePathname() ?? ""
  const { status } = useAuth()
  if (!pathname.startsWith("/live") || NO_SESSION_UI.test(pathname)) return null
  if (status === "expired") return <SessionExpiredSheet />
  if (status === "offline") return <OfflineNotice />
  return null
}

function OfflineNotice() {
  const { refreshAuth } = useAuth()
  const [checking, setChecking] = useState(false)
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-sm shadow-lg"
    >
      <span>Can&apos;t reach Void Live. Retrying…</span>
      <Button
        size="sm"
        variant="outline"
        disabled={checking}
        onClick={() => {
          setChecking(true)
          void refreshAuth().finally(() => setChecking(false))
        }}
      >
        Retry now
      </Button>
    </div>
  )
}

export function SessionExpiredSheet() {
  const { user, reportSignedIn, signOut } = useAuth()
  const pathname = usePathname() ?? "/live"
  const [open, setOpen] = useState(true)
  const [email, setEmail] = useState(user?.email ?? "")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [needsNewPassword, setNeedsNewPassword] = useState(false)
  const [busy, setBusy] = useState(false)

  // Re-open if another request hits the dead session after the sheet was minimised.
  useEffect(() => authEvents.on("session-expired", () => setOpen(true)), [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(res.status >= 500 ? "Couldn't sign in right now. Try again." : "Wrong email or password.")
        return
      }
      if (data.challenge === "NEW_PASSWORD_REQUIRED") {
        setNeedsNewPassword(true)
        return
      }
      setPassword("")
      await reportSignedIn()
    } catch {
      setError("Can't reach the server. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  function minimise() {
    setOpen(false)
    // Requests waiting for a sign-in fail now, so their callers can show an error and keep the data.
    authEvents.cancelWaiters()
  }

  const loginHref = `/live/login?next=${encodeURIComponent(pathname)}`

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : minimise())}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Your session ended</DialogTitle>
            <DialogDescription>Sign in again to keep going. Your changes on this page are kept.</DialogDescription>
          </DialogHeader>

          {needsNewPassword ? (
            <p className="text-sm text-fg-secondary">
              You need to set a new password first.{" "}
              <a href={loginHref} className="underline">
                Open the sign-in page
              </a>{" "}
              (this leaves the current page).
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-email">Email</Label>
                <Input
                  id="session-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-password">Password</Label>
                <Input
                  id="session-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  autoFocus={!!email}
                  required
                />
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => void signOut()}>
                  Sign out
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {!open && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-sm shadow-lg"
        >
          <span>Signed out. Changes won&apos;t save.</span>
          <Button size="sm" onClick={() => setOpen(true)}>
            Sign in
          </Button>
        </div>
      )}
    </>
  )
}
