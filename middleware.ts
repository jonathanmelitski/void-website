import { NextRequest, NextResponse } from "next/server"
import { decodeJwt } from "jose"

// Silently refreshes the Cognito access token before it expires (or after its cookie is gone),
// so long sessions (film review, live scoring) never start failing with "Not authenticated".
// Runs on the edge runtime, so Cognito is called over its JSON API instead of the AWS SDK.
// Route handlers still verify the token themselves; this only decides whether to refresh.

const REFRESH_LEEWAY_SECONDS = 60

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
}

function needsRefresh(token: string | undefined): boolean {
  if (!token) return true
  try {
    const { exp } = decodeJwt(token)
    return !exp || exp - REFRESH_LEEWAY_SECONDS <= Date.now() / 1000
  } catch {
    return true
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

type RefreshResult = { AccessToken: string; ExpiresIn?: number; RefreshToken?: string }

async function refreshTokens(refreshToken: string, username: string): Promise<RefreshResult | null> {
  try {
    const res = await fetch(`https://cognito-idp.${process.env.VOID_REGION}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: process.env.COGNITO_CLIENT_ID,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
          SECRET_HASH: await secretHash(username),
        },
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.AuthenticationResult?.AccessToken ? data.AuthenticationResult : null
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value
  const username = request.cookies.get("cognito_username")?.value

  if (!refreshToken || !username || !needsRefresh(request.cookies.get("access_token")?.value)) {
    return NextResponse.next()
  }

  const tokens = await refreshTokens(refreshToken, username)
  if (!tokens) return NextResponse.next() // route handler returns 401 as before

  // Forward the new token to this request's handler, and persist it for the browser
  request.cookies.set("access_token", tokens.AccessToken)
  const response = NextResponse.next({ request: { headers: request.headers } })

  response.cookies.set("access_token", tokens.AccessToken, {
    ...cookieOptions,
    maxAge: tokens.ExpiresIn ?? 3600,
  })
  // Only present when refresh token rotation is enabled on the app client
  if (tokens.RefreshToken) {
    response.cookies.set("refresh_token", tokens.RefreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60,
    })
  }

  return response
}

export const config = {
  // Auth routes that set or clear cookies themselves are excluded
  matcher: [
    "/api/((?!auth/(?:login|logout|refresh|challenge|register|confirm|confirm-reset|reset-password)).*)",
    "/live/:path*",
  ],
}
