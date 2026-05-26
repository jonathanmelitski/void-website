import { type NextRequest } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getYouTubeConnectionStatus, clearYouTubeCredentials } from "@/lib/aws/youtube"

export async function GET() {
  const status = await getYouTubeConnectionStatus()
  return Response.json(status)
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get("access_token")?.value
  if (!token) return new Response("Unauthorized", { status: 401 })
  const payload = await verifyToken(token).catch(() => null)
  if (!payload) return new Response("Unauthorized", { status: 401 })
  const groups: string[] = payload["cognito:groups"] ?? []
  if (!groups.includes("ADMIN")) return new Response("Forbidden", { status: 403 })

  await clearYouTubeCredentials()
  return new Response(null, { status: 204 })
}
