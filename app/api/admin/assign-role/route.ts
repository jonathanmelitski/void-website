import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { cognitoClient } from "@/lib/aws/cognito"
import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider"

const GROUPS = ["USER", "COACH", "ADMIN"]

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { username, role } = await request.json()
  if (!username || !role || !GROUPS.includes(role)) {
    return NextResponse.json({ error: "username and valid role are required" }, { status: 400 })
  }

  const poolId = process.env.COGNITO_USER_POOL_ID!

  // Remove from all other groups, add to new group
  await Promise.all(
    GROUPS.filter(g => g !== role).map(group =>
      cognitoClient
        .send(new AdminRemoveUserFromGroupCommand({ UserPoolId: poolId, Username: username, GroupName: group }))
        .catch(() => {}) // ignore if not in group
    )
  )

  await cognitoClient.send(
    new AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: username, GroupName: role })
  )

  return NextResponse.json({ ok: true })
}
