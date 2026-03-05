import { NextRequest, NextResponse } from "next/server"
import { ConfirmSignUpCommand, ResendConfirmationCodeCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { secretHash } from "@/lib/aws/cognito-secret"

export async function POST(request: NextRequest) {
  const { email, code, resend } = await request.json()

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 })
  }

  try {
    if (resend) {
      await cognitoClient.send(
        new ResendConfirmationCodeCommand({
          ClientId: process.env.COGNITO_CLIENT_ID!,
          Username: email,
          SecretHash: secretHash(email),
        })
      )
      return NextResponse.json({ ok: true })
    }

    if (!code) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 })
    }

    await cognitoClient.send(
      new ConfirmSignUpCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        Username: email,
        ConfirmationCode: code,
        SecretHash: secretHash(email),
      })
    )
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Confirmation failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
