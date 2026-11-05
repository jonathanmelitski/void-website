"use client"

// Client fetch layer for /api calls. Makes auth failures recoverable instead of fatal:
// - 401: refresh the session once (one shared in-flight refresh across callers, and across tabs
//   via navigator.locks), then retry. If the session is really over, emit "session-expired" so the
//   in-place sign-in sheet opens — never a redirect, so unsaved work on the page survives.
//   With { waitForSession: true } the call waits for that sign-in and then retries.
// - 503 AUTH_UNAVAILABLE (server couldn't verify the token): short backoff retries.
// - Network failure: throws NetworkError. It never means "signed out".
//
// Hook point for the future scoring offline queue: catch NetworkError / SessionExpiredError and
// hold the mutation; subscribe to authEvents "signed-in" / window "online" to drain.

export class NetworkError extends Error {
  constructor(message = "Can't reach the server. Check your connection.") {
    super(message)
    this.name = "NetworkError"
  }
}

export class SessionExpiredError extends Error {
  constructor(message = "Your session ended. Sign in again to continue.") {
    super(message)
    this.name = "SessionExpiredError"
  }
}

type AuthEvent = "session-expired" | "signed-in" | "signed-out"

// Tiny in-page event bus shared by apiFetch, AuthProvider and the session sheet.
class AuthEvents extends EventTarget {
  private waiters: { resolve: () => void; reject: (e: Error) => void }[] = []

  emit(type: AuthEvent) {
    if (type === "signed-in") {
      const w = this.waiters
      this.waiters = []
      w.forEach((x) => x.resolve())
    }
    if (type === "signed-out") this.cancelWaiters()
    this.dispatchEvent(new Event(type))
  }

  on(type: AuthEvent, fn: () => void): () => void {
    this.addEventListener(type, fn)
    return () => this.removeEventListener(type, fn)
  }

  /** Resolves after the user signs in again (sheet, login page or another tab). */
  waitForSession(): Promise<void> {
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  /** Rejects everything waiting for a sign-in (user dismissed the sheet / signed out). */
  cancelWaiters() {
    const w = this.waiters
    this.waiters = []
    w.forEach((x) => x.reject(new SessionExpiredError()))
  }
}

export const authEvents: AuthEvents =
  typeof window === "undefined"
    ? new AuthEvents()
    : (((window as unknown as { __voidAuthEvents?: AuthEvents }).__voidAuthEvents ??= new AuthEvents()))

export type RefreshOutcome = "ok" | "expired" | "unavailable"

let refreshInFlight: Promise<RefreshOutcome> | null = null

async function doRefresh(): Promise<RefreshOutcome> {
  let res: Response
  try {
    res = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", cache: "no-store" })
  } catch {
    throw new NetworkError()
  }
  if (res.ok) return "ok"
  if (res.status === 401) return "expired"
  return "unavailable"
}

/** Single-flight session refresh. Concurrent callers (and tabs, where supported) share one request. */
export function refreshSessionOnce(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined
  const run = (): Promise<RefreshOutcome> =>
    locks ? (locks.request("void-auth-refresh", doRefresh) as unknown as Promise<RefreshOutcome>) : doRefresh()
  const p = run().finally(() => {
    // Let callers that arrive in the same tick reuse the result.
    setTimeout(() => (refreshInFlight = null), 0)
  })
  refreshInFlight = p
  return p
}

export type ApiFetchInit = RequestInit & {
  /** On a dead session, wait for the user to sign in again (in place) and retry, instead of returning the 401. */
  waitForSession?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function rawFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new NetworkError()
  }
}

async function isAuthUnavailable(res: Response): Promise<boolean> {
  if (res.status !== 503) return false
  try {
    const body = await res.clone().json()
    return body?.code === "AUTH_UNAVAILABLE"
  } catch {
    return false
  }
}

export async function apiFetch(input: RequestInfo | URL, init: ApiFetchInit = {}): Promise<Response> {
  const { waitForSession = false, ...req } = init
  const reqInit: RequestInit = { credentials: "same-origin", ...req }

  let res = await rawFetch(input, reqInit)

  // The server couldn't verify the token (JWKS/Cognito blip). Auth runs before any business logic,
  // so retrying is safe even for writes.
  for (const delay of [500, 1000, 2000]) {
    if (!(await isAuthUnavailable(res))) break
    await sleep(delay)
    res = await rawFetch(input, reqInit)
  }

  if (res.status !== 401) return res

  const outcome = await refreshSessionOnce()
  if (outcome === "ok") {
    res = await rawFetch(input, reqInit)
    if (res.status !== 401) return res
  } else if (outcome === "unavailable") {
    return res // can't tell; leave the session alone and let the caller show a retryable error
  }

  authEvents.emit("session-expired")
  if (!waitForSession) return res
  await authEvents.waitForSession() // rejects with SessionExpiredError if the user gives up
  return rawFetch(input, reqInit)
}

/** Reads `{ error }` from a failed JSON response with a fallback, for user-facing messages. */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return "Your session ended. Sign in again to continue."
  if (res.status === 403) return "You don't have permission to do that."
  try {
    const body = await res.clone().json()
    return typeof body?.error === "string" && body.error ? body.error : fallback
  } catch {
    return fallback
  }
}
