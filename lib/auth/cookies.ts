import type { NextResponse } from "next/server"

// Session cookie names and lifetimes, shared by login, challenge, refresh, proxy and logout.
export const ACCESS_COOKIE = "access_token"
export const REFRESH_COOKIE = "refresh_token"
export const USERNAME_COOKIE = "cognito_username"
// Display only (access tokens carry no email). Never used for auth decisions.
export const EMAIL_COOKIE = "cognito_email"

// Matches the Cognito app client's refresh-token validity. The cookies are re-set on every
// successful refresh so they slide together; Cognito's own refresh-token expiry still applies.
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
}

type CookieJar = Pick<NextResponse["cookies"], "set">

export type SessionCookieValues = {
  accessToken: string
  expiresIn?: number
  /** Only set when the caller has one (sign-in, or rotation on refresh). */
  refreshToken?: string
  /** Existing refresh token to re-set (slides its expiry) when no new one was issued. */
  existingRefreshToken?: string
  /** Cognito's real username (UUID), used for refresh SECRET_HASH. */
  username: string
  /** Sign-in email, for display. */
  email?: string
}

export function setSessionCookies(cookies: CookieJar, v: SessionCookieValues) {
  cookies.set(ACCESS_COOKIE, v.accessToken, { ...cookieOptions, maxAge: v.expiresIn ?? 3600 })
  const refresh = v.refreshToken ?? v.existingRefreshToken
  if (refresh) {
    cookies.set(REFRESH_COOKIE, refresh, { ...cookieOptions, maxAge: REFRESH_MAX_AGE_SECONDS })
  }
  cookies.set(USERNAME_COOKIE, v.username, { ...cookieOptions, maxAge: REFRESH_MAX_AGE_SECONDS })
  if (v.email) cookies.set(EMAIL_COOKIE, v.email, { ...cookieOptions, maxAge: REFRESH_MAX_AGE_SECONDS })
}

export function clearSessionCookies(cookies: CookieJar) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, USERNAME_COOKIE, EMAIL_COOKIE]) {
    cookies.set(name, "", { ...cookieOptions, maxAge: 0 })
  }
}
