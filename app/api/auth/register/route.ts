import { NextRequest, NextResponse } from "next/server"
import { SignUpCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { secretHash } from "@/lib/aws/cognito-secret"

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
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
    const message = err instanceof Error ? err.message : "Registration failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
