import { NextResponse } from "next/server"
import { ScanCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo, getEvent } from "@/lib/aws/dynamo"

const TABLE = () => process.env.DYNAMO_GAMES_TABLE!

export async function GET() {
  try {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: TABLE(),
        FilterExpression: "#s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": "IN_PROGRESS" },
        ProjectionExpression: "id, opponent, round, scoreVoid, scoreOpponent, eventId",
      })
    )

    const games = result.Items ?? []
    if (games.length === 0) return NextResponse.json([])

    // Fetch events for all unique eventIds to check privacy
    const uniqueEventIds = [...new Set(games.map(g => g.eventId as string).filter(Boolean))]
    const events = await Promise.all(uniqueEventIds.map(id => getEvent(id)))
    const privateEventIds = new Set(
      events.filter(e => e?.isPrivate).map(e => e!.id)
    )

    const publicGames = games.filter(g => !privateEventIds.has(g.eventId as string))
    return NextResponse.json(publicGames)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch live games"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
