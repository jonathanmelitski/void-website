// Server helpers shared by the role and user-admin routes.
import { ListUsersInGroupCommand } from "@aws-sdk/client-cognito-identity-provider"
import { lookupUserByUsername } from "@/lib/auth/cognito-lookup"
import { cognitoClient } from "@/lib/aws/cognito"
import { listRoles } from "@/lib/aws/roles"
import type { AuthOk } from "@/lib/auth/server"
import type { Permission } from "./catalog"
import type { Actor } from "./guard"
import { OWNER_GROUP } from "./server"

export const actorFrom = (auth: AuthOk): Actor => ({ sub: auth.sub, isOwner: auth.isOwner, permissions: auth.permissions })

/** roleId → permissions, read fresh (not cached) so guard decisions see the latest roles. */
export async function rolePermissionMap(): Promise<Map<string, Permission[]>> {
  return new Map((await listRoles()).map((r) => [r.id, r.permissions]))
}

/** Role names for audit entries (IDs are meaningless to a reader). */
export async function roleNames(ids: readonly string[]): Promise<string[]> {
  const byId = new Map((await listRoles()).map((r) => [r.id, r.name]))
  return ids.map((id) => byId.get(id) ?? "(deleted role)")
}

const poolId = () => process.env.COGNITO_USER_POOL_ID!

/** Cognito usernames in the Owner group. */
export async function listOwnerUsernames(): Promise<Set<string>> {
  const names = new Set<string>()
  let NextToken: string | undefined
  do {
    const res = await cognitoClient.send(new ListUsersInGroupCommand({ UserPoolId: poolId(), GroupName: OWNER_GROUP, NextToken }))
    for (const u of res.Users ?? []) if (u.Username) names.add(u.Username)
    NextToken = res.NextToken
  } while (NextToken)
  return names
}

export type TargetUser = { username: string; sub: string; email: string; isOwner: boolean }

/**
 * Look up a user by Cognito username. Null if they don't exist.
 * ListUsers, not AdminGetUser: the app's IAM user isn't allowed AdminGetUser (see cognito-lookup.ts).
 */
export async function getTargetUser(username: string): Promise<TargetUser | null> {
  const [user, owners] = await Promise.all([lookupUserByUsername(username), listOwnerUsernames()])
  if (!user?.Username) return null
  const attr = (n: string) => user.Attributes?.find((a) => a.Name === n)?.Value ?? ""
  return { username: user.Username, sub: attr("sub"), email: attr("email"), isOwner: owners.has(user.Username) }
}
