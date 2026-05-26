import { type NextRequest } from "next/server"
import { randomBytes } from "crypto"
import { verifyToken } from "@/lib/aws/cognito"

const SCOPE = "https://www.googleapis.com/auth/youtube"

export async function GET(req: NextRequest) {
  const token = req.cookies.get("access_token")?.value
  if (!token) return new Response("Unauthorized", { status: 401 })
  const payload = await verifyToken(token).catch(() => null)
  if (!payload) return new Response("Unauthorized", { status: 401 })
  const groups: string[] = payload["cognito:groups"] ?? []
  if (!groups.includes("ADMIN")) return new Response("Forbidden", { status: 403 })

  const origin = new URL(req.url).origin
  const redirectUri = `${origin}/api/youtube/callback`
  const state = randomBytes(16).toString("hex")

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  authUrl.searchParams.set("client_id", process.env.YOUTUBE_CLIENT_ID!)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", SCOPE)
  authUrl.searchParams.set("access_type", "offline")
  authUrl.searchParams.set("prompt", "consent")
  authUrl.searchParams.set("state", state)

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": `yt_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
    },
  })
}
