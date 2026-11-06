import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getGame, updateGame, deleteGame } from "@/lib/aws/games"
import { canViewGame, getCaller } from "@/lib/event-access"
import { pushGameUpdate } from "@/lib/ws-push"
import { isTestGame } from "@/lib/test-games"
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"

const lambdaClient = new LambdaClient({
  region: process.env.VOID_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

async function invokeWorker(functionName: string, payload: object): Promise<void> {
  await lambdaClient.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify(payload)),
  }))
}

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const game = await getGame(id)
    if (!game || !(await canViewGame(game, await getCaller(request)))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json(game)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch game"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { id } = await params
  // A game can't be moved to another event or switch in or out of test mode.
  const fields = await request.json()
  delete fields.isTest
  delete fields.eventId
  delete fields.id

  try {
    const prev = await getGame(id)
    await updateGame(id, { ...fields, updatedAt: new Date().toISOString() })
    const updated = await getGame(id)
    pushGameUpdate(id).catch(() => {})

    // Auto-lifecycle: spin up / tear down resources when game status changes
    const broadcastFn  = process.env.BROADCAST_WORKER_FUNCTION_NAME
    const liveServerFn = process.env.LIVE_SERVER_WORKER_FUNCTION_NAME
    // Test games never start or stop the broadcast or the live server (they'd stop a real game's).
    if (isTestGame(prev)) {
      // no lifecycle
    } else if (fields.status === "IN_PROGRESS" && prev?.status === "SCHEDULED") {
      if (liveServerFn) invokeWorker(liveServerFn, { action: "start" }).catch(() => {})
      if (broadcastFn)  invokeWorker(broadcastFn,  { action: "prepare", gameId: id }).catch(() => {})
    } else if (fields.status === "FINAL") {
      if (broadcastFn)  invokeWorker(broadcastFn,  { action: "stop" }).catch(() => {})
      if (liveServerFn) invokeWorker(liveServerFn, { action: "stop" }).catch(() => {})
    }

    return NextResponse.json(updated)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update game"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { id } = await params
  try {
    await deleteGame(id)
    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete game"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
