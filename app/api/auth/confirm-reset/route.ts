import { NextRequest, NextResponse } from "next/server"
import { ConfirmForgotPasswordCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { secretHash } from "@/lib/aws/cognito-secret"

export async function POST(request: NextRequest) {
  const { email, code, password } = await request.json()

  if (!email || !code || !password) {
    return NextResponse.json({ error: "Email, code, and password are required" }, { status: 400 })
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
    const message = err instanceof Error ? err.message : "Password reset failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
