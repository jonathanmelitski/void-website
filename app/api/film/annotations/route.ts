import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { randomUUID } from "crypto"
import { AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider"
import { cognitoClient } from "@/lib/aws/cognito"
import { getPlayerLink } from "@/lib/aws/player-links"
import { getPlayer } from "@/lib/aws/players"
import { listAnnotationsByClip, createAnnotation } from "@/lib/aws/film-annotations"
import { getClip } from "@/lib/aws/film-clips"
import { pushFilmUpdate } from "@/lib/ws-push"
import { denyIfGameHidden } from "@/lib/event-access"
import { NO_STORE_HEADERS } from "@/lib/http-cache"

export async function GET(request: NextRequest) {
  const clipId = request.nextUrl.searchParams.get("clipId")
  if (!clipId) return NextResponse.json({ error: "clipId is required" }, { status: 400 })

  const auth = await requireUser(request)
  if (!auth.ok) return auth.response

  try {
    // Annotations inherit their clip's game/event visibility (private events 404)
    const [clip, annotations] = await Promise.all([getClip(clipId), listAnnotationsByClip(clipId)])
    // (annotations also carry gameId, which covers leftovers of a deleted clip)
    const gameId = clip?.gameId ?? annotations[0]?.gameId
    if (gameId) {
      const denied = await denyIfGameHidden(request, gameId)
      if (denied) return denied
    }
    return NextResponse.json(annotations, { headers: NO_STORE_HEADERS })
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
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload } = auth

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
