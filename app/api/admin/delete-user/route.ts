import { NextRequest, NextResponse } from "next/server"
import { verifyToken, cognitoClient } from "@/lib/aws/cognito"
import { AdminDeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider"

export async function POST(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  if (!(payload["cognito:groups"] ?? []).includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

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
