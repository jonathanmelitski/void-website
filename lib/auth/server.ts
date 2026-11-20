import { NextRequest, NextResponse } from "next/server"
import { AuthError, verifyToken, type TokenPayload } from "@/lib/aws/cognito"
import { ACCESS_COOKIE } from "./cookies"
import { lookupEmailBySub } from "./cognito-lookup"
import { canAny, type Permission } from "@/lib/permissions/catalog"
import { resolvePermissions } from "@/lib/permissions/server"

/** Stable machine-readable codes the client (`lib/api-fetch.ts`) keys off. */
export type AuthErrorCode = "SESSION_EXPIRED" | "FORBIDDEN" | "AUTH_UNAVAILABLE"

export type AuthOk = {
  ok: true
  payload: TokenPayload
  username: string
  /** Cognito sub: the key for role assignments. */
  sub: string
  /** Effective permissions (union of the user's roles; everything for owners). */
  permissions: Set<Permission>
  isOwner: boolean
  roleIds: string[]
}
export type AuthFail = { ok: false; response: NextResponse }

export function authErrorResponse(code: AuthErrorCode): NextResponse {
  switch (code) {
    case "SESSION_EXPIRED":
      return NextResponse.json({ error: "Not authenticated", code }, { status: 401 })
    case "FORBIDDEN":
      return NextResponse.json({ error: "Forbidden", code }, { status: 403 })
    case "AUTH_UNAVAILABLE":
      return NextResponse.json(
        { error: "Couldn't check your sign-in. Try again.", code },
        { status: 503, headers: { "Retry-After": "2" } }
      )
  }
}

/**
 * Auth gate for route handlers. Call it first:
 *
 *   const auth = await requireUser(request, { permission: "events.manage" })
 *   if (!auth.ok) return auth.response
 *
 * `permission` may be a list: the caller needs any one of them. Permissions live in
 * lib/permissions/catalog.ts; for finer checks inside a handler use `can(auth.permissions, …)`.
 *
 * 401 SESSION_EXPIRED: no/expired/invalid token (client refreshes and retries).
 * 403 FORBIDDEN: signed in, but missing the permission.
 * 503 AUTH_UNAVAILABLE: couldn't verify the token or read permissions — never treated as allowed.
 */
export async function requireUser(
  request: NextRequest,
  opts: { permission?: Permission | readonly Permission[] } = {}
): Promise<AuthOk | AuthFail> {
  const token = request.cookies.get(ACCESS_COOKIE)?.value
  if (!token) return { ok: false, response: authErrorResponse("SESSION_EXPIRED") }

  let payload: TokenPayload
  try {
    payload = await verifyToken(token)
  } catch (err) {
    const unavailable = err instanceof AuthError && err.kind === "unavailable"
    if (unavailable) console.warn("[auth] token verification unavailable:", (err as Error).message)
    return { ok: false, response: authErrorResponse(unavailable ? "AUTH_UNAVAILABLE" : "SESSION_EXPIRED") }
  }

  let resolved: Awaited<ReturnType<typeof resolvePermissions>>
  try {
    resolved = await resolvePermissions(payload.sub, payload["cognito:groups"])
  } catch (err) {
    console.warn("[auth] permission lookup failed:", err instanceof Error ? err.name : "unknown")
    return { ok: false, response: authErrorResponse("AUTH_UNAVAILABLE") }
  }

  if (opts.permission) {
    const needed = typeof opts.permission === "string" ? [opts.permission] : opts.permission
    if (!canAny(resolved.permissions, needed)) return { ok: false, response: authErrorResponse("FORBIDDEN") }
  }

  return {
    ok: true,
    payload,
    username: payload["cognito:username"] ?? payload.sub ?? "",
    sub: payload.sub,
    ...resolved,
  }
}

// Cognito access tokens carry no `email` claim, so look it up (read-only AdminGetUser) and cache it
// per username in this server instance. Never taken from a cookie: it's used for authorization
// (private-event allowedUsers).
const emailCache = new Map<string, { email: string | null; at: number }>()
const EMAIL_TTL_MS = 60 * 60 * 1000

export async function getCallerEmail(payload: TokenPayload): Promise<string | undefined> {
  if (payload.email) return payload.email
  const sub = payload.sub
  if (!sub) return undefined
  const hit = emailCache.get(sub)
  if (hit && Date.now() - hit.at < EMAIL_TTL_MS) return hit.email ?? undefined
  try {
    const email = await lookupEmailBySub(sub)
    emailCache.set(sub, { email, at: Date.now() })
    return email ?? undefined
  } catch (err) {
    console.warn("[auth] email lookup failed:", err instanceof Error ? err.name : "unknown")
    return undefined // fail closed: private events stay hidden
  }
}

/**
 * For public routes that show more to signed-in users. Returns null for anonymous callers
 * and on any verification failure (fails closed: private data stays hidden).
 */
export async function getOptionalUser(request: NextRequest): Promise<TokenPayload | null> {
  const token = request.cookies.get(ACCESS_COOKIE)?.value
  if (!token) return null
  try {
    return await verifyToken(token)
  } catch {
    return null
  }
}

export type OptionalAuth = {
  payload: TokenPayload
  username: string
  sub: string
  permissions: Set<Permission>
  isOwner: boolean
}

/**
 * Like getOptionalUser, plus the caller's permissions. Null for anonymous callers and on any failure,
 * including a failed permission lookup (fails closed: private data stays hidden).
 */
export async function getOptionalAuth(request: NextRequest): Promise<OptionalAuth | null> {
  const payload = await getOptionalUser(request)
  if (!payload) return null
  try {
    const { permissions, isOwner } = await resolvePermissions(payload.sub, payload["cognito:groups"])
    return { payload, username: payload["cognito:username"] ?? payload.sub ?? "", sub: payload.sub, permissions, isOwner }
  } catch {
    return null
  }
}
