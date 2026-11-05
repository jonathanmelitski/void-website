import { NextRequest, NextResponse } from "next/server"
import {
  RespondToAuthChallengeCommand,
  ChallengeNameType,
} from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient, cognitoUsernameFromAccessToken } from "@/lib/aws/cognito"
import { setSessionCookies } from "@/lib/auth/cookies"
import { secretHash } from "@/lib/aws/cognito-secret"

export async function POST(request: NextRequest) {
  const { email, session, newPassword } = await request.json()

  if (!email || !session || !newPassword) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  try {
    const result = await cognitoClient.send(
      new RespondToAuthChallengeCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        ChallengeName: ChallengeNameType.NEW_PASSWORD_REQUIRED,
        Session: session,
        ChallengeResponses: {
          USERNAME: email,
          NEW_PASSWORD: newPassword,
          SECRET_HASH: secretHash(email),
        },
      })
    )

    const tokens = result.AuthenticationResult
    if (!tokens?.AccessToken || !tokens?.RefreshToken) {
      return NextResponse.json({ error: "Failed to set password" }, { status: 401 })
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
    const message = err instanceof Error ? err.message : "Failed to set password"
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
