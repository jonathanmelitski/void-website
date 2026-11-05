import { NextRequest, NextResponse } from "next/server"
import { ConfirmForgotPasswordCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { secretHash } from "@/lib/aws/cognito-secret"
import { authError } from "@/lib/auth-errors"

export async function POST(request: NextRequest) {
  const { email, code, password } = await request.json()

  if (!email || !code || !password) {
    return NextResponse.json({ error: "Enter the code and a new password." }, { status: 400 })
  }

  try {
    await cognitoClient.send(
      new ConfirmForgotPasswordCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        Username: email,
        ConfirmationCode: code,
        Password: password,
        SecretHash: secretHash(email),
      })
    )
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json(authError(err, "confirm-reset"), { status: 400 })
  }
}
