import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { cognitoClient } from "@/lib/aws/cognito"
import { AdminCreateUserCommand } from "@aws-sdk/client-cognito-identity-provider"
import { setUserRoles } from "@/lib/aws/user-roles"
import { logAudit } from "@/lib/aws/audit"
import { canAssignRoles } from "@/lib/permissions/guard"
import { actorFrom, roleNames, rolePermissionMap } from "@/lib/permissions/admin"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { permission: "users.manage" })
  if (!auth.ok) return auth.response

  const { email, roleIds = [] } = await request.json()
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 })
  if (!Array.isArray(roleIds) || !roleIds.every((r: unknown) => typeof r === "string")) {
    return NextResponse.json({ error: "roleIds must be a list of role IDs" }, { status: 400 })
  }
  const roles = await rolePermissionMap()
  // New user: no sub yet, so "self" can't match. Every role granted must be grantable by the inviter.
  const check = canAssignRoles(actorFrom(auth), "", [], roleIds, roles)
  if (!check.ok) return NextResponse.json({ error: check.reason, code: "FORBIDDEN" }, { status: 403 })

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

  const sub = user?.Attributes?.find(a => a.Name === "sub")?.Value
  const granted = [...new Set(roleIds as string[])]
  if (sub && granted.length) {
    try {
      await setUserRoles(sub, granted, auth.username)
      const names = await roleNames(granted).catch(() => granted)
      void logAudit({
        actorUsername: auth.username,
        action: "UPDATE",
        entityType: "USER_ROLES",
        entityId: sub,
        entityLabel: email,
        previousState: { roles: [] },
        newState: { roles: names },
        reversible: false,
      })
    } catch (err) {
      console.error("[invite-user] role assignment failed:", err instanceof Error ? err.name : "unknown")
      return NextResponse.json(
        { error: "Invited, but couldn't assign roles. Set them from the Users list." },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    username: user?.Username ?? email,
    email,
    status: user?.UserStatus ?? "FORCE_CHANGE_PASSWORD",
    roleIds: sub ? granted : [],
    isOwner: false,
  })
}
