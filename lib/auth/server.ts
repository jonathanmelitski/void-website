import { NextRequest, NextResponse } from "next/server"
import { AuthError, verifyToken, type TokenPayload } from "@/lib/aws/cognito"
import { ACCESS_COOKIE } from "./cookies"

export type Role = "ADMIN" | "COACH" | "USER"

export const ADMIN_ONLY: Role[] = ["ADMIN"]
export const COACH_OR_ADMIN: Role[] = ["COACH", "ADMIN"]

/** Stable machine-readable codes the client (`lib/api-fetch.ts`) keys off. */
export type AuthErrorCode = "SESSION_EXPIRED" | "FORBIDDEN" | "AUTH_UNAVAILABLE"

export type AuthOk = { ok: true; payload: TokenPayload; groups: string[]; username: string }
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
 *   const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
 *   if (!auth.ok) return auth.response
 *
 * 401 SESSION_EXPIRED: no/expired/invalid token (client refreshes and retries).
 * 403 FORBIDDEN: signed in, but not in any of `roles`.
 * 503 AUTH_UNAVAILABLE: couldn't verify (JWKS/Cognito unreachable) — not a sign-out.
 */
export async function requireUser(
  request: NextRequest,
  opts: { roles?: readonly Role[] } = {}
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

  const groups = payload["cognito:groups"] ?? []
  if (opts.roles && !opts.roles.some((r) => groups.includes(r))) {
    return { ok: false, response: authErrorResponse("FORBIDDEN") }
  }

  return { ok: true, payload, groups, username: payload["cognito:username"] ?? payload.sub ?? "" }
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
