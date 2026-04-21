import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { cognitoClient } from "@/lib/aws/cognito"
import {
  ListUsersCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider"

const GROUPS = ["USER", "COACH", "ADMIN"]

export async function GET(request: NextRequest) {
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
