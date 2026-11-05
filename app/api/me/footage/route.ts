import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { getPlayerLink } from "@/lib/aws/player-links"
import { getPlayer, listPlayers, type PlayerItem } from "@/lib/aws/players"
import { listPointsByGame, listPointsByPlayer, type PointItem } from "@/lib/aws/points"
import { listEventsByGame } from "@/lib/aws/point-events"
import { getGames, type GameItem } from "@/lib/aws/games"
import { getEvent, type EventItem } from "@/lib/aws/dynamo"
import { listClipsByGame, type FilmClipItem } from "@/lib/aws/film-clips"
import { canViewEvent, getCaller } from "@/lib/event-access"
import { deriveGameStats, type PlayerStats } from "@/lib/stats/derive"

// Everything /live/me shows, in one request (it used to be 1 + 1 + 3 per game, many of them 404s for
// deleted games). Read-only.
//
// Response: {
//   link, player, cognitoSub,            // same as GET /api/me/player
//   games: [{ gameId, gameLabel, eventId, opponent, round?,
//             clips: FilmClipItem[],     // READY clips only; games without any are omitted
//             points: { id, gameId, pointNumber, lineType, outcome }[],  // points this player was on the line for
//             stats: PlayerStats | null  // this player's derived stats for the game (lib/stats/derive)
//           }]
// }
// Games that were deleted, or whose event the caller can't see, are left out.

type FootageGame = {
  gameId: string
  gameLabel: string
  eventId: string
  opponent: string
  round?: string
  clips: FilmClipItem[]
  points: Pick<PointItem, "id" | "gameId" | "pointNumber" | "lineType" | "outcome">[]
  stats: PlayerStats | null
}

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const cognitoSub = auth.payload.sub

  try {
    const link = await getPlayerLink(cognitoSub)
    if (!link) {
      return NextResponse.json({ link: null, player: null, cognitoSub, games: [] }, { headers: NO_STORE })
    }

    const [player, myPoints, caller] = await Promise.all([
      getPlayer(link.playerId),
      listPointsByPlayer(link.playerId),
      getCaller(request),
    ])

    // Group this player's points by game, keeping first-seen order (the page's existing order)
    const byGame = new Map<string, PointItem[]>()
    for (const pt of myPoints) {
      if (!byGame.has(pt.gameId)) byGame.set(pt.gameId, [])
      byGame.get(pt.gameId)!.push(pt)
    }

    // One BatchGet for the games; ids of deleted games simply don't come back
    const gamesById = new Map<string, GameItem>((await getGames([...byGame.keys()])).map(g => [g.id, g]))

    // Event visibility (private events): one GetItem per distinct event
    const eventIds = [...new Set([...gamesById.values()].map(g => g.eventId))]
    const events = new Map<string, EventItem | null>(
      await Promise.all(eventIds.map(async id => [id, await getEvent(id)] as const))
    )
    // Same rule as canViewGame: a game whose event no longer exists has no privacy flag
    const visible = [...byGame.keys()].filter(id => {
      const game = gamesById.get(id)
      if (!game) return false
      const event = events.get(game.eventId)
      return !event || canViewEvent(event, caller)
    })

    // Clips per visible game; only games with READY film are shown
    const withClips = (
      await Promise.all(
        visible.map(async gameId => ({
          game: gamesById.get(gameId)!,
          clips: (await listClipsByGame(gameId)).filter(c => c.status === "READY"),
        }))
      )
    ).filter(g => g.clips.length > 0)

    // Derived stats only for the games that will be shown
    let roster: PlayerItem[] = []
    let perGame: { points: PointItem[]; events: Awaited<ReturnType<typeof listEventsByGame>> }[] = []
    if (withClips.length > 0) {
      ;[roster, perGame] = await Promise.all([
        listPlayers(),
        Promise.all(
          withClips.map(async ({ game }) => {
            const [points, evts] = await Promise.all([listPointsByGame(game.id), listEventsByGame(game.id)])
            return { points, events: evts }
          })
        ),
      ])
    }

    const games: FootageGame[] = withClips.map(({ game, clips }, i) => {
      const stats = deriveGameStats(game, perGame[i].points, perGame[i].events, roster)
      return {
        gameId: game.id,
        gameLabel: `vs ${game.opponent}${game.round ? ` · ${game.round}` : ""}`,
        eventId: game.eventId,
        opponent: game.opponent,
        ...(game.round ? { round: game.round } : {}),
        clips,
        points: (byGame.get(game.id) ?? []).map(({ id, gameId, pointNumber, lineType, outcome }) => ({
          id, gameId, pointNumber, lineType, outcome,
        })),
        stats: stats.players.find(s => s.playerId === link.playerId) ?? null,
      }
    })

    return NextResponse.json({ link, player, cognitoSub, games }, { headers: NO_STORE })
  } catch (err) {
    console.error("GET /api/me/footage failed", err)
    return NextResponse.json({ error: "Couldn't load your footage. Try again." }, { status: 500, headers: NO_STORE })
  }
}
