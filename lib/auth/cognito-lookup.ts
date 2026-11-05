import { AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"

/**
 * Read-only: resolve an email alias to the pool's real username (UUID).
 * Returns null when the user doesn't exist; throws on network/service errors.
 * Only used to migrate sessions whose username cookie still holds the email.
 */
export async function lookupCognitoUsername(email: string): Promise<string | null> {
  try {
    const res = await cognitoClient.send(
      new AdminGetUserCommand({ UserPoolId: process.env.COGNITO_USER_POOL_ID!, Username: email })
    )
    return res.Username ?? null
  } catch (err) {
    if (err instanceof Error && err.name === "UserNotFoundException") return null
    throw err
  }
}
