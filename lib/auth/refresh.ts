import { decodeJwt } from "jose"

// One refresh implementation for the proxy and /api/auth/refresh.
// Uses fetch + Web Crypto against Cognito's JSON API (no SDK), so it runs in any runtime.

export type RefreshSuccess = {
  ok: true
  accessToken: string
  expiresIn: number
  /** Present only when refresh-token rotation is enabled on the app client. */
  refreshToken?: string
  /** Cognito's real username (UUID), to store in the username cookie. */
  username: string
}

/** "invalid": the refresh token is dead, sign in again. "unavailable": Cognito unreachable, retry later. */
export type RefreshFailure = { ok: false; kind: "invalid" | "unavailable" }
export type RefreshResult = RefreshSuccess | RefreshFailure

export const REFRESH_LEEWAY_SECONDS = 60

export function accessTokenNeedsRefresh(token: string | undefined): boolean {
  if (!token) return true
  try {
    const { exp } = decodeJwt(token)
    return !exp || exp - REFRESH_LEEWAY_SECONDS <= Date.now() / 1000
  } catch {
    return true
  }
}

export function accessTokenExpiresAt(token: string | undefined): number | null {
  if (!token) return null
  try {
    const { exp } = decodeJwt(token)
    return typeof exp === "number" ? exp * 1000 : null
  } catch {
    return null
  }
}

function usernameFromAccessToken(token: string | undefined): string | null {
  if (!token) return null
  try {
    const c = decodeJwt(token) as { username?: string; sub?: string }
    return c.username ?? c.sub ?? null
  } catch {
    return null
  }
}

async function secretHash(username: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.COGNITO_CLIENT_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(username + process.env.COGNITO_CLIENT_ID!))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

/**
 * Sessions created before the username fix stored the email in the username cookie.
 * Resolve the real username: from any access token we still have (even expired), else
 * by looking the email alias up in the pool (read-only AdminGetUser).
 */
async function resolveUsername(
  stored: string,
  accessToken: string | undefined
): Promise<string | { failed: "invalid" | "unavailable" }> {
  if (!stored.includes("@")) return stored
  const fromToken = usernameFromAccessToken(accessToken)
  if (fromToken) return fromToken
  try {
    const { lookupCognitoUsername } = await import("./cognito-lookup")
    return (await lookupCognitoUsername(stored)) ?? { failed: "invalid" }
  } catch {
    return { failed: "unavailable" }
  }
}

async function callCognitoRefresh(refreshToken: string, username: string): Promise<RefreshResult> {
  let res: Response
  try {
    res = await fetch(`https://cognito-idp.${process.env.VOID_REGION}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: process.env.COGNITO_CLIENT_ID,
        AuthParameters: { REFRESH_TOKEN: refreshToken, SECRET_HASH: await secretHash(username) },
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { ok: false, kind: "unavailable" }
  }

  let data: { AuthenticationResult?: { AccessToken?: string; ExpiresIn?: number; RefreshToken?: string }; __type?: string } = {}
  try {
    data = await res.json()
  } catch {
    // fall through with empty data
  }

  if (res.ok && data.AuthenticationResult?.AccessToken) {
    const r = data.AuthenticationResult
    return {
      ok: true,
      accessToken: r.AccessToken!,
      expiresIn: r.ExpiresIn ?? 3600,
      ...(r.RefreshToken ? { refreshToken: r.RefreshToken } : {}),
      username: usernameFromAccessToken(r.AccessToken) ?? username,
    }
  }

  // 4xx auth errors (NotAuthorizedException, UserNotFoundException, ...) mean the session is over.
  // Throttling and 5xx mean try again later.
  const type = data.__type ?? ""
  if (res.status >= 500 || /TooManyRequests|Throttl|InternalError|ServiceUnavailable/.test(type)) {
    return { ok: false, kind: "unavailable" }
  }
  return { ok: false, kind: "invalid" }
}

// Single-flight per refresh token within this server instance: parallel requests that all
// arrive with an expired access token share one Cognito call. Successful results are reused
// for a few seconds so a burst of requests right after the refresh doesn't trigger another.
const inflight = new Map<string, { promise: Promise<RefreshResult>; at: number }>()
const REUSE_MS = 10_000

export async function refreshSession(opts: {
  refreshToken: string
  storedUsername: string | undefined
  accessToken?: string
}): Promise<RefreshResult> {
  const { refreshToken, storedUsername, accessToken } = opts
  const now = Date.now()
  for (const [k, v] of inflight) if (now - v.at > REUSE_MS) inflight.delete(k)

  const existing = inflight.get(refreshToken)
  if (existing) return existing.promise

  const promise = (async (): Promise<RefreshResult> => {
    const username = storedUsername
      ? await resolveUsername(storedUsername, accessToken)
      : usernameFromAccessToken(accessToken)
    if (!username) return { ok: false, kind: "invalid" }
    if (typeof username !== "string") return { ok: false, kind: username.failed }
    return callCognitoRefresh(refreshToken, username)
  })()

  inflight.set(refreshToken, { promise, at: now })
  promise.then((r) => {
    if (!r.ok) inflight.delete(refreshToken) // don't cache failures
  })
  return promise
}
