import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { EMAIL_COOKIE, USERNAME_COOKIE } from "@/lib/auth/cookies"

export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { payload } = auth

  // Access tokens carry no email; it's kept in a display cookie (older sessions: the username cookie).
  const legacy = request.cookies.get(USERNAME_COOKIE)?.value ?? ""
  const stored = request.cookies.get(EMAIL_COOKIE)?.value ?? legacy
  return NextResponse.json(
    {
      username: payload["cognito:username"] ?? payload.username ?? payload.sub,
      email: payload.email ?? (stored.includes("@") ? stored : ""),
      groups: payload["cognito:groups"] ?? [],
      expiresAt: payload.exp * 1000,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
