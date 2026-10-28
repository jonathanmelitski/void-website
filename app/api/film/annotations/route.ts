import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider"
import { verifyToken, cognitoClient } from "@/lib/aws/cognito"
import { getPlayerLink } from "@/lib/aws/player-links"
import { getPlayer } from "@/lib/aws/players"
import { listAnnotationsByClip, createAnnotation } from "@/lib/aws/film-annotations"
import { getClip } from "@/lib/aws/film-clips"
import { pushFilmUpdate } from "@/lib/ws-push"

export async function GET(request: NextRequest) {
  const clipId = request.nextUrl.searchParams.get("clipId")
  if (!clipId) return NextResponse.json({ error: "clipId is required" }, { status: 400 })

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  try {
    const annotations = await listAnnotationsByClip(clipId)
    return NextResponse.json(annotations)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch annotations"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Linked roster player's name, else the email's local part; never the raw Cognito username (a UUID)
async function resolveAuthorName(sub: string, username: string): Promise<string> {
  try {
    const link = await getPlayerLink(sub)
    const player = link ? await getPlayer(link.playerId) : null
    if (player) return `${player.first_name} ${player.last_name}`
  } catch { /* fall through */ }
  try {
    const user = await cognitoClient.send(new AdminGetUserCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID!,
      Username: username,
    }))
    const email = user.UserAttributes?.find(a => a.Name === "email")?.Value
    if (email) return email.split("@")[0]
  } catch { /* fall through */ }
  return "Coach"
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const groups = payload["cognito:groups"] ?? []
  if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { clipId, videoTimestampMs, text, pointEventId, pointId } = await request.json()
  if (!clipId || videoTimestampMs === undefined || (!text && !pointId)) {
    return NextResponse.json({ error: "clipId and videoTimestampMs are required; text or pointId must be provided" }, { status: 400 })
  }
  if (text && text.length > 500) {
    return NextResponse.json({ error: "Text must be 500 characters or fewer" }, { status: 400 })
  }

  const clip = await getClip(clipId)
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 })

  const username = payload["cognito:username"] ?? payload.sub
  const authorDisplayName = await resolveAuthorName(payload.sub, username)
  const now = new Date().toISOString()
  const annotation = {
    id: randomUUID(),
    clipId,
    gameId: clip.gameId,
    ...(pointEventId ? { pointEventId } : {}),
    ...(pointId ? { pointId } : {}),
    videoTimestampMs,
    text: text ?? "",
    authorUsername: username,
    authorDisplayName,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await createAnnotation(annotation)
    // Fire-and-forget WS push for real-time collaboration
    pushFilmUpdate(clipId, { type: "ANNOTATION_CREATED", annotation, ts: Date.now() })
    return NextResponse.json(annotation, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create annotation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
