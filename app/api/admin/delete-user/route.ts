import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { cognitoClient } from "@/lib/aws/cognito"
import { AdminDeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider"
import { deleteUserRoles, getUserRoles } from "@/lib/aws/user-roles"
import { canAssignRoles } from "@/lib/permissions/guard"
import { actorFrom, getTargetUser, rolePermissionMap } from "@/lib/permissions/admin"
import { invalidatePermissionCache } from "@/lib/permissions/server"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { permission: "users.manage" })
  if (!auth.ok) return auth.response

  const { username } = await request.json()
  if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 })

  const target = await getTargetUser(username)
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (target.sub === auth.sub) {
    return NextResponse.json({ error: "You can't delete your own account here." }, { status: 403 })
  }
  // Owners are removed through AWS only. Others: only if you could take away every role they hold.
  if (target.isOwner) {
    return NextResponse.json({ error: "Owners can only be removed in AWS.", code: "FORBIDDEN" }, { status: 403 })
  }
  const held = target.sub ? await getUserRoles(target.sub) : []
  const check = canAssignRoles(actorFrom(auth), target.sub, held, [], await rolePermissionMap())
  if (!check.ok) return NextResponse.json({ error: check.reason, code: "FORBIDDEN" }, { status: 403 })

  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({ UserPoolId: process.env.COGNITO_USER_POOL_ID!, Username: username })
    )
    if (target.sub) {
      await deleteUserRoles(target.sub).catch(() => {}) // orphaned row is harmless: the sub is gone
      invalidatePermissionCache(target.sub)
    }
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error("[delete-user]", err)
    const message = err instanceof Error ? err.message : "Failed to delete user"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
