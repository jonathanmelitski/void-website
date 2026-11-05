"use client"

import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { authEvents, NetworkError, refreshSessionOnce } from "@/lib/api-fetch"
import { SessionStatusUI } from "@/components/session-expired-sheet"

export type AuthUser = {
  username: string
  email: string
  groups: string[]
  /** ms epoch when the current access token expires (for proactive refresh). */
  expiresAt?: number
}

/**
 * loading: first check in progress.
 * authenticated: signed in.
 * anonymous: no session (signed out, or the session was already dead when the page loaded).
 * expired: the session ended while the page was open — the in-place sign-in sheet is shown and
 *   `user` keeps the last profile so the page (and unsaved work) stays put.
 * offline: couldn't reach the server to check. Never treated as signed out; retries automatically.
 */
export type AuthStatus = "loading" | "authenticated" | "anonymous" | "expired" | "offline"

type AuthContextValue = {
  user: AuthUser | null
  status: AuthStatus
  /** True until we know whether there's a usable session (also while offline with no cached profile). */
  isLoading: boolean
  /** Re-check the session now. */
  refreshAuth: () => Promise<void>
  /** Call after a successful sign-in (login page, sheet): re-checks, wakes waiting requests, tells other tabs. */
  reportSignedIn: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  status: "loading",
  isLoading: true,
  refreshAuth: async () => {},
  reportSignedIn: async () => {},
  signOut: async () => {},
})

// Last known profile (no tokens) so a flaky connection at startup doesn't blank the app.
const PROFILE_KEY = "void:auth:profile"
function readCachedProfile(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}
function writeCachedProfile(u: AuthUser | null) {
  try {
    if (u) sessionStorage.setItem(PROFILE_KEY, JSON.stringify(u))
    else sessionStorage.removeItem(PROFILE_KEY)
  } catch {
    // storage unavailable: fine
  }
}

const CHANNEL = "void-auth"
const RECHECK_THROTTLE_MS = 30_000
const PROACTIVE_REFRESH_LEAD_MS = 5 * 60_000

type CheckResult = { kind: "ok"; user: AuthUser } | { kind: "anonymous" } | { kind: "offline" }

async function fetchMe(): Promise<CheckResult> {
  const get = async () => {
    try {
      return await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
    } catch {
      throw new NetworkError()
    }
  }
  try {
    let res = await get()
    if (res.status === 401) {
      // The proxy already tried a refresh on this request; this covers the cases it couldn't.
      const outcome = await refreshSessionOnce()
      if (outcome === "unavailable") return { kind: "offline" }
      if (outcome === "expired") return { kind: "anonymous" }
      res = await get()
    }
    if (res.ok) return { kind: "ok", user: (await res.json()) as AuthUser }
    if (res.status === 401) return { kind: "anonymous" }
    return { kind: "offline" } // 5xx / 503 AUTH_UNAVAILABLE: we don't know, keep trying
  } catch {
    return { kind: "offline" }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")
  const statusRef = useRef<AuthStatus>("loading")
  const userRef = useRef<AuthUser | null>(null)
  const lastCheck = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay = useRef(2000)
  const channel = useRef<BroadcastChannel | null>(null)
  const checkRef = useRef<() => Promise<void>>(async () => {})

  const [expiresAt, setExpiresAt] = useState<number | undefined>(undefined)

  const apply = useCallback((s: AuthStatus, u: AuthUser | null) => {
    if (u?.expiresAt) setExpiresAt(u.expiresAt)
    // Keep `user` referentially stable across re-checks: pages key data loads on it, and a
    // background re-check must never trigger a reload that clobbers unsaved state.
    const prev = userRef.current
    const same =
      !!prev && !!u &&
      prev.username === u.username &&
      prev.email === u.email &&
      prev.groups.join(",") === u.groups.join(",")
    const next = same ? prev : u ? { username: u.username, email: u.email, groups: u.groups } : null
    statusRef.current = s
    userRef.current = next
    setStatus(s)
    setUser(next)
  }, [])

  const check = useCallback(async () => {
    lastCheck.current = Date.now()
    if (retryTimer.current) clearTimeout(retryTimer.current)
    const result = await fetchMe()
    const prev = statusRef.current

    if (result.kind === "ok") {
      retryDelay.current = 2000
      writeCachedProfile(result.user)
      const wasExpired = prev === "expired"
      apply("authenticated", result.user)
      if (wasExpired) authEvents.emit("signed-in")
      return
    }

    if (result.kind === "anonymous") {
      // Mid-session (the page was signed in): keep the page and ask to sign in again in place.
      if (prev === "authenticated" || prev === "expired" || (prev === "offline" && userRef.current)) {
        apply("expired", userRef.current)
      } else {
        writeCachedProfile(null)
        apply("anonymous", null)
      }
      return
    }

    // offline / unknown: never sign out. Keep what we know and retry with backoff.
    const known = userRef.current ?? readCachedProfile()
    apply(prev === "expired" ? "expired" : "offline", known)
    retryTimer.current = setTimeout(() => void checkRef.current(), retryDelay.current)
    retryDelay.current = Math.min(retryDelay.current * 2, 30_000)
  }, [apply])

  useEffect(() => {
    checkRef.current = check
  }, [check])

  const reportSignedIn = useCallback(async () => {
    await check()
    authEvents.emit("signed-in")
    channel.current?.postMessage("signed-in")
  }, [check])

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
    } catch {
      // Offline: cookies stay until the next sign-out attempt, but this tab still signs out.
    }
    writeCachedProfile(null)
    apply("anonymous", null)
    authEvents.emit("signed-out")
    channel.current?.postMessage("signed-out")
  }, [apply])

  // Initial check, cross-tab sync, and re-checks when the app comes back to the foreground.
  useEffect(() => {
    void Promise.resolve().then(check)

    const onMessage = (msg: string) => {
      if (msg === "signed-in") void check().then(() => authEvents.emit("signed-in"))
      if (msg === "signed-out") {
        writeCachedProfile(null)
        apply("anonymous", null)
        authEvents.emit("signed-out")
      }
    }
    let bc: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(CHANNEL)
      bc.onmessage = (e) => onMessage(String(e.data))
      channel.current = bc
    }

    const recheck = () => {
      if (document.visibilityState !== "visible") return
      if (Date.now() - lastCheck.current < RECHECK_THROTTLE_MS && statusRef.current !== "offline") return
      void check()
    }
    const onOnline = () => void check()
    document.addEventListener("visibilitychange", recheck)
    window.addEventListener("focus", recheck)
    window.addEventListener("online", onOnline)

    const offExpired = authEvents.on("session-expired", () => {
      if (statusRef.current === "authenticated" || statusRef.current === "offline") {
        apply("expired", userRef.current ?? readCachedProfile())
      }
    })

    return () => {
      bc?.close()
      channel.current = null
      document.removeEventListener("visibilitychange", recheck)
      window.removeEventListener("focus", recheck)
      window.removeEventListener("online", onOnline)
      offExpired()
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [check, apply])

  // Proactive refresh shortly before the access token expires, so requests rarely hit a 401.
  // (Phones suspend timers; the visibility re-check above covers that.)
  useEffect(() => {
    if (status !== "authenticated" || !expiresAt) return
    const delay = Math.max(expiresAt - Date.now() - PROACTIVE_REFRESH_LEAD_MS, 10_000)
    const t = setTimeout(() => {
      refreshSessionOnce()
        .then(() => check())
        .catch(() => check())
    }, delay)
    return () => clearTimeout(t)
  }, [status, expiresAt, check])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isLoading: status === "loading" || (status === "offline" && !user),
      refreshAuth: check,
      reportSignedIn,
      signOut,
    }),
    [user, status, check, reportSignedIn, signOut]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SessionStatusUI />
    </AuthContext.Provider>
  )
}
