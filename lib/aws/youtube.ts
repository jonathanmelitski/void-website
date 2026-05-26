import { google } from "googleapis"
import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from "@aws-sdk/client-ssm"

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "us-east-2" })

const SSM_REFRESH_TOKEN = "/void/youtube/refresh_token"
const SSM_CHANNEL_TITLE = "/void/youtube/channel_title"
const CACHE_TTL_MS = 60 * 60 * 1000

let cached: { auth: ReturnType<typeof newOAuth2Client>; expiresAt: number } | null = null

function newOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID!,
    process.env.YOUTUBE_CLIENT_SECRET!
  )
}

export async function getYouTubeAuth() {
  if (cached && Date.now() < cached.expiresAt) return cached.auth
  const param = await ssm.send(new GetParameterCommand({ Name: SSM_REFRESH_TOKEN, WithDecryption: true }))
  const refreshToken = param.Parameter?.Value
  if (!refreshToken) throw new Error("YouTube channel not connected")
  const auth = newOAuth2Client()
  auth.setCredentials({ refresh_token: refreshToken })
  cached = { auth, expiresAt: Date.now() + CACHE_TTL_MS }
  return auth
}

async function getYouTube() {
  return google.youtube({ version: "v3", auth: await getYouTubeAuth() })
}

export async function getYouTubeConnectionStatus(): Promise<{ connected: boolean; channelTitle?: string }> {
  try {
    const [tokenParam, titleParam] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: SSM_REFRESH_TOKEN, WithDecryption: false })),
      ssm.send(new GetParameterCommand({ Name: SSM_CHANNEL_TITLE })),
    ])
    if (!tokenParam.Parameter) return { connected: false }
    return { connected: true, channelTitle: titleParam.Parameter?.Value }
  } catch {
    return { connected: false }
  }
}

export async function storeYouTubeCredentials(refreshToken: string, channelTitle: string): Promise<void> {
  cached = null
  await Promise.all([
    ssm.send(new PutParameterCommand({ Name: SSM_REFRESH_TOKEN, Value: refreshToken, Type: "SecureString", Overwrite: true })),
    ssm.send(new PutParameterCommand({ Name: SSM_CHANNEL_TITLE, Value: channelTitle, Type: "String", Overwrite: true })),
  ])
}

export async function clearYouTubeCredentials(): Promise<void> {
  cached = null
  await Promise.all([
    ssm.send(new DeleteParameterCommand({ Name: SSM_REFRESH_TOKEN })).catch(() => {}),
    ssm.send(new DeleteParameterCommand({ Name: SSM_CHANNEL_TITLE })).catch(() => {}),
  ])
}

// Returns resumable upload URL (Location header). Browser PUTs video directly here.
export async function createYouTubeUploadSession(opts: { title: string; contentType: string }): Promise<string> {
  const auth = await getYouTubeAuth()
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
    const token = await auth.getAccessToken()
    const res = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": opts.contentType,
        },
        body: JSON.stringify({
          snippet: { title: opts.title, categoryId: "17" },
          status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
        }),
      }
    )
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`YouTube session init failed: ${res.status}`)
    return res.headers.get("Location")!
  }
  throw new Error("YouTube session init failed: rate limited, try again in a moment")
}

export async function getYouTubeVideoStatus(videoId: string): Promise<{ uploadStatus: string; durationSeconds?: number }> {
  const yt = await getYouTube()
  const r = await yt.videos.list({ part: ["status", "contentDetails"], id: [videoId] })
  const item = r.data.items?.[0]
  if (!item) return { uploadStatus: "deleted" }
  return {
    uploadStatus: item.status!.uploadStatus!,
    durationSeconds: parseIso8601Duration(item.contentDetails?.duration ?? ""),
  }
}

export async function deleteYouTubeVideo(videoId: string): Promise<void> {
  const yt = await getYouTube()
  await yt.videos.delete({ id: videoId })
}

export async function createGamePlaylist(title: string): Promise<string> {
  const yt = await getYouTube()
  const res = await yt.playlists.insert({
    part: ["snippet", "status"],
    requestBody: { snippet: { title }, status: { privacyStatus: "unlisted" } },
  })
  return res.data.id!
}

export async function addVideoToPlaylist(opts: { playlistId: string; videoId: string; position: number }): Promise<string> {
  const yt = await getYouTube()
  const res = await yt.playlistItems.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        playlistId: opts.playlistId,
        resourceId: { kind: "youtube#video", videoId: opts.videoId },
        position: opts.position,
      },
    },
  })
  return res.data.id!
}

export async function removeVideoFromPlaylist(playlistItemId: string): Promise<void> {
  const yt = await getYouTube()
  await yt.playlistItems.delete({ id: playlistItemId })
}

export async function movePlaylistItem(opts: {
  playlistItemId: string
  playlistId: string
  videoId: string
  newPosition: number
}): Promise<void> {
  const yt = await getYouTube()
  await yt.playlistItems.update({
    part: ["snippet"],
    requestBody: {
      id: opts.playlistItemId,
      snippet: {
        playlistId: opts.playlistId,
        resourceId: { kind: "youtube#video", videoId: opts.videoId },
        position: opts.newPosition,
      },
    },
  })
}

function parseIso8601Duration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0))
}
