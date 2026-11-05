import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { cognitoClient } from "@/lib/aws/cognito"
import {
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider"

const GROUPS = ["USER", "COACH", "ADMIN"]

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { email, role = "USER" } = await request.json()
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })
  if (!GROUPS.includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 })

  const poolId = process.env.COGNITO_USER_POOL_ID!

  let user
  try {
    const result = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      })
    )
    user = result.User
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "UsernameExistsException") {
      return NextResponse.json({ error: "User already exists" }, { status: 409 })
    }
    throw err
  }

  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: poolId,
      Username: email,
      GroupName: role,
    })
  )

  return NextResponse.json({
    username: user?.Username ?? email,
    email,
    status: user?.UserStatus ?? "FORCE_CHANGE_PASSWORD",
    role,
  })
}
