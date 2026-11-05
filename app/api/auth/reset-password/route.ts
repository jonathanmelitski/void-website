import { NextRequest, NextResponse } from "next/server"
import { ForgotPasswordCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { secretHash } from "@/lib/aws/cognito-secret"
import { authError } from "@/lib/auth-errors"

export async function POST(request: NextRequest) {
  const { email } = await request.json()

  if (!email) {
    return NextResponse.json({ error: "Enter your email." }, { status: 400 })
  }

  try {
    await cognitoClient.send(
      new ForgotPasswordCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        Username: email,
        SecretHash: secretHash(email),
      })
    )
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    // Don't reveal whether an account exists: an unknown (or unverified) email looks like success
    const name = err instanceof Error ? err.name : ""
    if (name === "UserNotFoundException" || name === "InvalidParameterException") {
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json(authError(err, "reset"), { status: 400 })
  }
}
