import { NextRequest, NextResponse } from "next/server"
import { InitiateAuthCommand, AuthFlowType } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { secretHash } from "@/lib/aws/cognito-secret"

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
}

export async function GET(request: NextRequest) {
  const redirectParam = request.nextUrl.searchParams.get("redirect")
  const refreshToken = request.cookies.get("refresh_token")?.value
  const username = request.cookies.get("cognito_username")?.value

  const loginUrl = new URL("/live/login", request.url)

  if (!refreshToken || !username) {
    return redirectParam
      ? NextResponse.redirect(loginUrl)
      : NextResponse.json({ error: "No refresh token" }, { status: 401 })
  }

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
          SECRET_HASH: secretHash(username),
        },
      })
    )

    const tokens = result.AuthenticationResult
    if (!tokens?.AccessToken) {
      return redirectParam
        ? NextResponse.redirect(loginUrl)
        : NextResponse.json({ error: "Refresh failed" }, { status: 401 })
    }

    // Only allow same-origin redirects to prevent open redirect
    const dest =
      redirectParam?.startsWith("/")
        ? new URL(redirectParam, request.url)
        : null

    const response = dest
      ? NextResponse.redirect(dest)
      : NextResponse.json({ ok: true })

    response.cookies.set("access_token", tokens.AccessToken, {
      ...cookieOptions,
      maxAge: tokens.ExpiresIn ?? 3600,
    })

    return response
  } catch {
    return redirectParam
      ? NextResponse.redirect(loginUrl)
      : NextResponse.json({ error: "Refresh failed" }, { status: 401 })
  }
}
