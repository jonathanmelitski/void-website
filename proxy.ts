import { NextRequest, NextResponse } from "next/server"
import { accessTokenNeedsRefresh, refreshSession } from "@/lib/auth/refresh"
import {
  ACCESS_COOKIE,
  EMAIL_COOKIE,
  REFRESH_COOKIE,
  USERNAME_COOKIE,
  clearSessionCookies,
  cookieOptions,
  REFRESH_MAX_AGE_SECONDS,
  setSessionCookies,
} from "@/lib/auth/cookies"
import { decodeJwt } from "jose"

// Keeps sessions alive without the user noticing:
// - refreshes the Cognito access token shortly before it expires (or after its cookie is gone),
//   forwards the new token to this request's handler and persists it (sliding cookie expiry);
// - migrates sessions whose username cookie still holds the email (pre-fix) to the real username;
// - sends signed-out document requests for protected /live pages to /live/login?next=...
// Route handlers still verify the token themselves (lib/auth/server.ts); this never authorizes.

// /live pages that work without a session.
const PUBLIC_LIVE = /^\/live\/(login|register|confirm|confirm-reset|reset-password|watch|scoreboard)(\/|$)/

function isProtectedDocumentRequest(request: NextRequest): boolean {
  const { pathname } = request.nextUrl
  if (!pathname.startsWith("/live") || PUBLIC_LIVE.test(pathname)) return false
  if (request.method !== "GET") return false
  // Client-side (RSC) navigations and prefetches are left to the in-page session handling,
  // so an open page never gets yanked away; only full page loads redirect.
  if (request.headers.get("rsc") || request.headers.get("next-router-prefetch")) return false
  const dest = request.headers.get("sec-fetch-dest")
  if (dest) return dest === "document"
  return (request.headers.get("accept") ?? "").includes("text/html")
}

function loginRedirect(request: NextRequest): NextResponse {
  const url = new URL("/live/login", request.url)
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url)
}

function legacyUsernameMigration(accessToken: string | undefined, storedUsername: string | undefined) {
  if (!accessToken || !storedUsername?.includes("@")) return null
  try {
    const claims = decodeJwt(accessToken) as { username?: string; sub?: string }
    const username = claims.username ?? claims.sub
    return username ? { username, email: storedUsername } : null
  } catch {
    return null
  }
}

export async function proxy(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value
  const storedUsername = request.cookies.get(USERNAME_COOKIE)?.value
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value

  if (!refreshToken) {
    if (!accessToken && isProtectedDocumentRequest(request)) return loginRedirect(request)
    return NextResponse.next()
  }

  if (!accessTokenNeedsRefresh(accessToken)) {
    // Valid access token. Opportunistically fix a pre-fix username cookie (no Cognito call).
    const migration = legacyUsernameMigration(accessToken, storedUsername)
    if (!migration) return NextResponse.next()
    const res = NextResponse.next()
    res.cookies.set(USERNAME_COOKIE, migration.username, { ...cookieOptions, maxAge: REFRESH_MAX_AGE_SECONDS })
    res.cookies.set(EMAIL_COOKIE, migration.email, { ...cookieOptions, maxAge: REFRESH_MAX_AGE_SECONDS })
    return res
  }

  const result = await refreshSession({ refreshToken, storedUsername, accessToken })

  if (!result.ok) {
    if (result.kind === "unavailable") return NextResponse.next() // handler answers 401/503; client retries
    // Refresh token is dead: drop the session cookies so we stop retrying it on every request.
    request.cookies.delete(ACCESS_COOKIE)
    const res = isProtectedDocumentRequest(request)
      ? loginRedirect(request)
      : NextResponse.next({ request: { headers: request.headers } })
    clearSessionCookies(res.cookies)
    // Keep the display email so the sign-in form can be prefilled.
    const email = request.cookies.get(EMAIL_COOKIE)?.value ?? (storedUsername?.includes("@") ? storedUsername : undefined)
    if (email) res.cookies.set(EMAIL_COOKIE, email, { ...cookieOptions, maxAge: REFRESH_MAX_AGE_SECONDS })
    return res
  }

  // Forward the new token to this request's handler, and persist it for the browser.
  request.cookies.set(ACCESS_COOKIE, result.accessToken)
  const response = NextResponse.next({ request: { headers: request.headers } })
  setSessionCookies(response.cookies, {
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
    refreshToken: result.refreshToken,
    existingRefreshToken: refreshToken,
    username: result.username,
    email: storedUsername?.includes("@") ? storedUsername : undefined,
  })
  return response
}

export const config = {
  // Auth routes that set or clear cookies themselves are excluded. /api/auth/me is included,
  // so the client's session check refreshes transparently too.
  matcher: [
    "/api/((?!auth/(?:login|logout|refresh|challenge|register|confirm|confirm-reset|reset-password)).*)",
    "/live/:path*",
  ],
}
