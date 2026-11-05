import { NextRequest, NextResponse } from "next/server"
import { refreshSession, accessTokenExpiresAt } from "@/lib/auth/refresh"
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  USERNAME_COOKIE,
  cookieOptions,
  setSessionCookies,
} from "@/lib/auth/cookies"

// Client-driven refresh (lib/api-fetch.ts, AuthProvider). Shares its implementation with the proxy.
// 200 {ok, expiresAt} | 401 {code: SESSION_EXPIRED} | 503 {code: AUTH_UNAVAILABLE}
async function handle(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value
  const storedUsername = request.cookies.get(USERNAME_COOKIE)?.value
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value

  if (!refreshToken) {
    return NextResponse.json({ error: "Not signed in", code: "SESSION_EXPIRED" }, { status: 401 })
  }

  const result = await refreshSession({ refreshToken, storedUsername, accessToken })

  if (!result.ok) {
    if (result.kind === "unavailable") {
      return NextResponse.json(
        { error: "Couldn't reach the sign-in service. Try again.", code: "AUTH_UNAVAILABLE" },
        { status: 503, headers: { "Retry-After": "2" } }
      )
    }
    const res = NextResponse.json({ error: "Session ended", code: "SESSION_EXPIRED" }, { status: 401 })
    // The refresh token is dead; drop the stale access cookie but keep nothing that can't work.
    res.cookies.set(ACCESS_COOKIE, "", { ...cookieOptions, maxAge: 0 })
    return res
  }

  const res = NextResponse.json({ ok: true, expiresAt: accessTokenExpiresAt(result.accessToken) })
  setSessionCookies(res.cookies, {
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
    refreshToken: result.refreshToken,
    existingRefreshToken: refreshToken,
    username: result.username,
    // Migrating a pre-fix session: the old username cookie held the email; keep it for display.
    email: storedUsername?.includes("@") ? storedUsername : undefined,
  })
  res.headers.set("Cache-Control", "no-store")
  return res
}

export const POST = handle
// Kept for older clients; same behaviour (the old ?redirect= mode had no callers and is gone).
export const GET = handle
