import { NextRequest, NextResponse } from "next/server"
import { RevokeTokenCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { REFRESH_COOKIE, clearSessionCookies } from "@/lib/auth/cookies"

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value

  // Best effort: revoke the refresh token so a copied cookie stops working.
  // Signing out locally never depends on Cognito being reachable.
  if (refreshToken) {
    try {
      await cognitoClient.send(
        new RevokeTokenCommand({
          Token: refreshToken,
          ClientId: process.env.COGNITO_CLIENT_ID!,
          ClientSecret: process.env.COGNITO_CLIENT_SECRET!,
        })
      )
    } catch (err) {
      console.warn("[auth] refresh token revoke failed:", err instanceof Error ? err.name : "unknown")
    }
  }

  const response = NextResponse.json({ ok: true })
  clearSessionCookies(response.cookies)
  return response
}
