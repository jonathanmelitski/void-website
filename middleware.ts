import { NextRequest, NextResponse } from "next/server"
import { createRemoteJWKSet, jwtVerify } from "jose"

function getJWKS() {
  const url = `https://cognito-idp.${process.env.VOID_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`
  return createRemoteJWKSet(new URL(url))
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value

  if (!token) {
    return NextResponse.redirect(new URL("/live/login", request.url))
  }

  try {
    const issuer = `https://cognito-idp.${process.env.VOID_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`
    await jwtVerify(token, getJWKS(), { issuer })
    return NextResponse.next()
  } catch {
    return NextResponse.redirect(new URL("/live/login", request.url))
  }
}

export const config = {
  matcher: ["/live/dashboard/:path*"],
}
