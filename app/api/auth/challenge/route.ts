import { NextRequest, NextResponse } from "next/server"
import {
  RespondToAuthChallengeCommand,
  ChallengeNameType,
} from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
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

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    }

    response.cookies.set("access_token", tokens.AccessToken, {
      ...cookieOptions,
      maxAge: tokens.ExpiresIn ?? 3600,
    })
    response.cookies.set("refresh_token", tokens.RefreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60,
    })

    return response
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to set password"
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
