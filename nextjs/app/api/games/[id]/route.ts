import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getGame, updateGame, deleteGame } from "@/lib/aws/games"
import { pushGameUpdate } from "@/lib/ws-push"
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

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const game = await getGame(id)
    if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(game)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch game"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Props) {
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

  const { id } = await params
  const fields = await request.json()

  try {
    const prev = await getGame(id)
    await updateGame(id, { ...fields, updatedAt: new Date().toISOString() })
    const updated = await getGame(id)
    pushGameUpdate(id).catch(() => {})

    // Auto-lifecycle: spin up / tear down resources when game status changes
    const broadcastFn  = process.env.BROADCAST_WORKER_FUNCTION_NAME
    const liveServerFn = process.env.LIVE_SERVER_WORKER_FUNCTION_NAME
    if (fields.status === "IN_PROGRESS" && prev?.status === "SCHEDULED") {
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

  const { id } = await params
  try {
    await deleteGame(id)
    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete game"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
