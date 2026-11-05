import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider"
import { createRemoteJWKSet, decodeJwt, errors as joseErrors, jwtVerify } from "jose"

export const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.VOID_REGION!,
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

// Module singleton: jose caches the key set per server instance and only refetches
// on an unknown `kid` (cooldown 30s) or after cacheMaxAge.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJWKS() {
  if (!jwks) {
    const url = `https://cognito-idp.${process.env.VOID_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`
    jwks = createRemoteJWKSet(new URL(url), {
      timeoutDuration: 5000,
      cooldownDuration: 30_000,
      cacheMaxAge: 6 * 60 * 60 * 1000, // Cognito signing keys rotate rarely
    })
  }
  return jwks
}

export type TokenPayload = {
  sub: string
  "cognito:username"?: string
  username?: string
  email?: string
  "cognito:groups"?: string[]
  token_use?: string
  client_id?: string
  exp: number
}

/**
 * Why a token was rejected. Only "expired"/"invalid" mean the user must re-authenticate;
 * "unavailable" means we couldn't check (JWKS fetch failed) and the client should retry.
 */
export type AuthErrorKind = "expired" | "invalid" | "unavailable"

export class AuthError extends Error {
  constructor(public kind: AuthErrorKind, message: string) {
    super(message)
    this.name = "AuthError"
  }
}

const CLOCK_TOLERANCE_SECONDS = 30

export async function verifyToken(token: string): Promise<TokenPayload> {
  const issuer = `https://cognito-idp.${process.env.VOID_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`
  let payload: TokenPayload
  try {
    const result = await jwtVerify(token, getJWKS(), { issuer, clockTolerance: CLOCK_TOLERANCE_SECONDS })
    payload = result.payload as TokenPayload
  } catch (err) {
    throw classifyJoseError(err)
  }
  // Only access tokens issued to this app client are accepted.
  if (payload.token_use && payload.token_use !== "access") {
    throw new AuthError("invalid", "Not an access token")
  }
  if (payload.client_id && process.env.COGNITO_CLIENT_ID && payload.client_id !== process.env.COGNITO_CLIENT_ID) {
    throw new AuthError("invalid", "Token issued to another client")
  }
  return payload
}

function classifyJoseError(err: unknown): AuthError {
  if (err instanceof joseErrors.JWTExpired) return new AuthError("expired", "Token expired")
  if (
    err instanceof joseErrors.JWSSignatureVerificationFailed ||
    err instanceof joseErrors.JWTClaimValidationFailed ||
    err instanceof joseErrors.JWSInvalid ||
    err instanceof joseErrors.JWTInvalid ||
    err instanceof joseErrors.JWKSNoMatchingKey ||
    err instanceof joseErrors.JWKSMultipleMatchingKeys ||
    err instanceof joseErrors.JOSEAlgNotAllowed ||
    err instanceof joseErrors.JOSENotSupported
  ) {
    return new AuthError("invalid", "Invalid token")
  }
  // JWKSTimeout, JWKSInvalid (bad response), network errors, anything unknown: we couldn't check.
  return new AuthError("unavailable", "Could not verify token")
}

/**
 * The pool's real username (a UUID when the pool signs in with email). Refresh SECRET_HASH
 * must be computed from this, not from the email the user typed.
 */
export function cognitoUsernameFromAccessToken(accessToken: string): string | null {
  try {
    const claims = decodeJwt(accessToken) as Partial<TokenPayload>
    return claims.username ?? claims["cognito:username"] ?? claims.sub ?? null
  } catch {
    return null
  }
}
