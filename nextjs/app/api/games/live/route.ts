import { NextResponse } from "next/server"
import { ScanCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "@/lib/aws/dynamo"

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
    return NextResponse.json(result.Items ?? [])
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch live games"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
