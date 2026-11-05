import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { cognitoClient } from "@/lib/aws/cognito"
import { AdminDeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { username } = await request.json()
  if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 })

  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({ UserPoolId: process.env.COGNITO_USER_POOL_ID!, Username: username })
    )
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("[delete-user]", err)
    const message = err instanceof Error ? err.message : "Failed to delete user"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
