import { type NextRequest } from "next/server"
import { google } from "googleapis"
import { storeYouTubeCredentials } from "@/lib/aws/youtube"

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const origin = url.origin
  const manageUrl = `${origin}/live/manage?tab=film`

  const error = url.searchParams.get("error")
  if (error) {
    return Response.redirect(`${manageUrl}&youtube_error=${encodeURIComponent(error)}`)
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const savedState = req.cookies.get("yt_oauth_state")?.value

  if (!state || !savedState || state !== savedState) {
    return new Response("Invalid OAuth state", { status: 400 })
  }
  if (!code) {
    return new Response("Missing code", { status: 400 })
  }

  const redirectUri = `${origin}/api/youtube/callback`
  const auth = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID!,
    process.env.YOUTUBE_CLIENT_SECRET!,
    redirectUri
  )

  const { tokens } = await auth.getToken(code)
  if (!tokens.refresh_token) {
    return Response.redirect(`${manageUrl}&youtube_error=no_refresh_token`)
  }

  auth.setCredentials(tokens)
  const yt = google.youtube({ version: "v3", auth })
  const channelRes = await yt.channels.list({ part: ["snippet"], mine: true })
  const channelTitle = channelRes.data.items?.[0]?.snippet?.title ?? "YouTube Channel"

  await storeYouTubeCredentials(tokens.refresh_token, channelTitle)

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${manageUrl}&youtube_connected=1`,
      "Set-Cookie": "yt_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    },
  })
}
