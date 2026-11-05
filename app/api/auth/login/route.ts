import { NextRequest, NextResponse } from "next/server"
import {
  InitiateAuthCommand,
  AuthFlowType,
} from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient, cognitoUsernameFromAccessToken } from "@/lib/aws/cognito"
import { setSessionCookies } from "@/lib/auth/cookies"
import { secretHash } from "@/lib/aws/cognito-secret"
import { authError } from "@/lib/auth-errors"

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()

  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 })
  }

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
          SECRET_HASH: secretHash(email),
        },
      })
    )

    // Admin-created users must set a new password on first sign-in.
    if (result.ChallengeName === "NEW_PASSWORD_REQUIRED") {
      return NextResponse.json({
        challenge: "NEW_PASSWORD_REQUIRED",
        session: result.Session,
        email,
      })
    }

    const tokens = result.AuthenticationResult
    if (!tokens?.AccessToken || !tokens?.RefreshToken) {
      return NextResponse.json({ error: "Couldn't sign you in. Try again." }, { status: 401 })
    }

    const response = NextResponse.json({ ok: true })
    // Store Cognito's real username (UUID), not the email: refresh SECRET_HASH is computed from it.
    setSessionCookies(response.cookies, {
      accessToken: tokens.AccessToken,
      expiresIn: tokens.ExpiresIn,
      refreshToken: tokens.RefreshToken,
      username: cognitoUsernameFromAccessToken(tokens.AccessToken) ?? email,
      email,
    })

    return response
  } catch (err: unknown) {
    return NextResponse.json(authError(err, "login"), { status: 401 })
  }
}
