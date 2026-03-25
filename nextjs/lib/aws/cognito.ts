import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider"
import { createRemoteJWKSet, jwtVerify } from "jose"

export const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.VOID_REGION!,
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJWKS() {
  if (!jwks) {
    const url = `https://cognito-idp.${process.env.VOID_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`
    jwks = createRemoteJWKSet(new URL(url))
  }
  return jwks
}

export type TokenPayload = {
  sub: string
  "cognito:username"?: string
  username?: string
  email?: string
  "cognito:groups"?: string[]
  exp: number
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const issuer = `https://cognito-idp.${process.env.VOID_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`
  const { payload } = await jwtVerify(token, getJWKS(), { issuer })
  return payload as TokenPayload
}
