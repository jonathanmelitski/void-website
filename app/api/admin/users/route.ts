import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { cognitoClient } from "@/lib/aws/cognito"
import { ListUsersCommand, type UserType } from "@aws-sdk/client-cognito-identity-provider"
import { listUserRoles } from "@/lib/aws/user-roles"
import { listOwnerUsernames } from "@/lib/permissions/admin"

export type AdminUserRow = {
  username: string
  sub: string
  email: string
  enabled: boolean
  status: string
  roleIds: string[]
  isOwner: boolean
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { permission: "users.manage" })
  if (!auth.ok) return auth.response

  const poolId = process.env.COGNITO_USER_POOL_ID!
  const listAll = async () => {
    const users: UserType[] = []
    let PaginationToken: string | undefined
    do {
      const res = await cognitoClient.send(new ListUsersCommand({ UserPoolId: poolId, PaginationToken }))
      users.push(...(res.Users ?? []))
      PaginationToken = res.PaginationToken
    } while (PaginationToken)
    return users
  }

  const [cognitoUsers, owners, assignments] = await Promise.all([listAll(), listOwnerUsernames(), listUserRoles()])
  const rolesBySub = new Map(assignments.map((a) => [a.sub, a.roleIds ?? []]))

  const users: AdminUserRow[] = cognitoUsers.map((u) => {
    const attr = (n: string) => u.Attributes?.find((a) => a.Name === n)?.Value ?? ""
    const sub = attr("sub")
    return {
      username: u.Username ?? "",
      sub,
      email: attr("email"),
      enabled: u.Enabled ?? true,
      status: u.UserStatus ?? "",
      roleIds: rolesBySub.get(sub) ?? [],
      isOwner: owners.has(u.Username ?? ""),
    }
  })

  return NextResponse.json(users)
}
