import { createHmac } from "crypto"

export function secretHash(username: string): string {
  const clientId = process.env.COGNITO_CLIENT_ID!
  const clientSecret = process.env.COGNITO_CLIENT_SECRET!
  return createHmac("sha256", clientSecret)
    .update(username + clientId)
    .digest("base64")
}
