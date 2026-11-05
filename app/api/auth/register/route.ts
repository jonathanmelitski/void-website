import { NextRequest, NextResponse } from "next/server"
import { SignUpCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { secretHash } from "@/lib/aws/cognito-secret"
import { authError } from "@/lib/auth-errors"

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()

  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and a password." }, { status: 400 })
  }

  try {
    await cognitoClient.send(
      new SignUpCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        Username: email,
        Password: password,
        SecretHash: secretHash(email),
        UserAttributes: [{ Name: "email", Value: email }],
      })
    )
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json(authError(err, "register"), { status: 400 })
  }
}
