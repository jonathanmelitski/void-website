import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { cognitoClient } from "@/lib/aws/cognito"
import {
  ListUsersCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider"

const GROUPS = ["USER", "COACH", "ADMIN"]

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response

  const poolId = process.env.COGNITO_USER_POOL_ID!

  const [usersResult, ...groupResults] = await Promise.all([
    cognitoClient.send(new ListUsersCommand({ UserPoolId: poolId })),
    ...GROUPS.map(group =>
      cognitoClient.send(new ListUsersInGroupCommand({ UserPoolId: poolId, GroupName: group }))
    ),
  ])

  const groupMembership: Record<string, string> = {}
  GROUPS.forEach((group, i) => {
    for (const u of groupResults[i].Users ?? []) {
      if (u.Username) groupMembership[u.Username] = group
    }
  })

  const users = (usersResult.Users ?? []).map(u => ({
    username: u.Username ?? "",
    email: u.Attributes?.find(a => a.Name === "email")?.Value ?? "",
    enabled: u.Enabled ?? true,
    status: u.UserStatus ?? "",
    role: groupMembership[u.Username ?? ""] ?? "USER",
  }))

  return NextResponse.json(users)
}
