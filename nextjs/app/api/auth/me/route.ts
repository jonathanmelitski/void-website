import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"

export async function GET(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value

  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const payload = await verifyToken(token)
    return NextResponse.json({
      username: payload["cognito:username"] ?? payload.username ?? payload.sub,
      email: payload.email ?? "",
      groups: payload["cognito:groups"] ?? [],
    })
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }
}
