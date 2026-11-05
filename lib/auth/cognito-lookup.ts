import { ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"

// Read-only user lookups. ListUsers (not AdminGetUser): it's the permission the app's IAM user
// already has for the admin Users panel; AdminGetUser is denied for it.

function quote(v: string) {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

async function findUser(attr: "email" | "sub", value: string) {
  const res = await cognitoClient.send(
    new ListUsersCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID!,
      Filter: `${attr} = ${quote(value)}`,
      Limit: 2,
    })
  )
  return res.Users ?? []
}

/**
 * Resolve an email to the pool's real username (UUID). Returns null when no single user matches;
 * throws on network/service errors. Used to migrate sessions whose username cookie holds the email.
 */
export async function lookupCognitoUsername(email: string): Promise<string | null> {
  const users = await findUser("email", email)
  return users.length === 1 ? users[0].Username ?? null : null
}

/** The email attribute of the user with this `sub`, or null. Throws on network/service errors. */
export async function lookupEmailBySub(sub: string): Promise<string | null> {
  const users = await findUser("sub", sub)
  return users[0]?.Attributes?.find((a) => a.Name === "email")?.Value ?? null
}
