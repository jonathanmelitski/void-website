// Server-side event visibility (CLAUDE.md: private events are filtered at the API layer).
// Public events are visible to everyone; private ones to holders of events.viewPrivate and to emails in allowedUsers.
// Games, points and point events inherit their event's visibility.
import { NextResponse, type NextRequest } from "next/server"
import { getCallerEmail, getOptionalAuth } from "@/lib/auth/server"
import { can, type Permission } from "@/lib/permissions/catalog"
import { getEvent, type EventItem } from "@/lib/aws/dynamo"
import { getGame, type GameItem } from "@/lib/aws/games"
import { getBroadcastState } from "@/lib/aws/broadcast-jobs"
import { isTestGame } from "@/lib/test-games"

export type Caller = { permissions: ReadonlySet<Permission>; email?: string } | null

export async function getCaller(request: NextRequest): Promise<Caller> {
  const auth = await getOptionalAuth(request)
  if (!auth) return null
  // Staff see everything; only look the email up when it can matter.
  if (can(auth.permissions, "events.viewPrivate")) return { permissions: auth.permissions }
  return { permissions: auth.permissions, email: await getCallerEmail(auth.payload) }
}

/** Sees every private event, test game and stats warning (events.viewPrivate). */
export const isCoach = (caller: Caller) => !!caller && can(caller.permissions, "events.viewPrivate")

export function canViewEvent(event: Pick<EventItem, "isPrivate" | "allowedUsers">, caller: Caller): boolean {
  if (!event.isPrivate) return true
  if (isCoach(caller)) return true
  const email = caller?.email?.toLowerCase()
  return !!email && (event.allowedUsers?.some((u) => u.toLowerCase() === email) ?? false)
}

// The game currently on the public broadcast is public by definition: the cookieless scoreboard
// overlay (/live/scoreboard/[gameId], loaded by MediaLive) reads its data from the same endpoints.
let broadcastCache: { gameId: string | null; at: number } | null = null
async function broadcastGameId(): Promise<string | null> {
  if (broadcastCache && Date.now() - broadcastCache.at < 15_000) return broadcastCache.gameId
  try {
    const state = await getBroadcastState()
    broadcastCache = { gameId: state?.gameId ?? null, at: Date.now() }
  } catch {
    broadcastCache = { gameId: null, at: Date.now() }
  }
  return broadcastCache.gameId
}

/**
 * True if the caller may see this game's data. Test games: events.viewPrivate only. A game whose event no
 * longer exists has no privacy flag.
 */
export async function canViewGame(game: Pick<GameItem, "id" | "eventId"> & Partial<Pick<GameItem, "isTest">>, caller: Caller): Promise<boolean> {
  if (isTestGame(game)) return isCoach(caller)
  const event = await getEvent(game.eventId)
  if (!event || canViewEvent(event, caller)) return true
  return (await broadcastGameId()) === game.id
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 })

/** For GET routes keyed by gameId: a 404 response when the caller can't see the game, else null. */
export async function denyIfGameHidden(request: NextRequest, gameId: string): Promise<NextResponse | null> {
  const game = await getGame(gameId)
  if (!game) return null // let the route answer as it always has (empty list / its own 404)
  return (await canViewGame(game, await getCaller(request))) ? null : notFound()
}

/** For GET routes keyed by eventId. */
export async function denyIfEventHidden(request: NextRequest, eventId: string): Promise<NextResponse | null> {
  const event = await getEvent(eventId)
  if (!event) return null
  return canViewEvent(event, await getCaller(request)) ? null : notFound()
}
