import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { getChannelStatus } from "@/lib/aws/medialive"
import {
  getBroadcastState,
  getJob,
  saveJob,
  JOB_PK,
  streamPrepare,
  streamGoLive,
  streamStart,
  streamStop,
  streamDestroyAll,
} from "@/lib/aws/broadcast-jobs"
import { scheduleGraphicsOverlay } from "@/lib/aws/medialive"
import type { StreamEvent } from "@/lib/step-types"
import type { ChannelState } from "@/lib/aws/medialive"
import type { JobItem } from "@/lib/aws/broadcast-jobs"

export const maxDuration = 300 // respected by Vercel; ignored by Amplify (see broadcast-worker Lambda)

// ---- Auth ----

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  try {
    const payload = await verifyToken(token)
    const groups: string[] = payload["cognito:groups"] ?? []
    return groups.includes("ADMIN") ? payload : null
  } catch {
    return null
  }
}

// ---- Lambda async invocation (production / Amplify) ----

const lambdaClient = new LambdaClient({
  region: process.env.VOID_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

async function invokeWorkerAsync(payload: object): Promise<void> {
  await lambdaClient.send(new InvokeCommand({
    FunctionName: process.env.BROADCAST_WORKER_FUNCTION_NAME!,
    InvocationType: "Event", // async — returns immediately, Lambda runs in background
    Payload: Buffer.from(JSON.stringify(payload)),
  }))
}

// ---- SSE fallback (local dev — no Lambda available) ----

function makeStream(fn: (send: (event: StreamEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) } catch {}
      }
      try {
        await fn(send)
      } catch (err) {
        try { send({ type: "error", message: err instanceof Error ? err.message : String(err) }) } catch {}
      } finally {
        try { controller.close() } catch {}
      }
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}

// ---- GET /api/broadcast ----

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const [broadcastState, job] = await Promise.all([
      getBroadcastState(),
      getJob(JOB_PK),
    ])

    let channelState: ChannelState = "IDLE"
    if (broadcastState?.channelId) {
      channelState = await getChannelStatus(broadcastState.channelId)
    }

    return NextResponse.json({
      state: channelState,
      channelId: broadcastState?.channelId ?? null,
      inputId:   broadcastState?.inputId ?? null,
      rtmpUrl:   broadcastState?.rtmpUrl ?? null,
      gameId:    broadcastState?.gameId ?? null,
      job:       job ?? null,
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    )
  }
}

// ---- POST /api/broadcast ----

export async function POST(request: NextRequest) {
  if (!await requireAdmin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json()
  const { action, gameId } = body as { action: string; gameId?: string }

  // Manual overlay re-activation (fast, no worker needed)
  if (action === "activate-overlay") {
    const broadcastState = await getBroadcastState()
    if (!broadcastState) {
      return NextResponse.json({ error: "No active broadcast" }, { status: 404 })
    }
    try {
      await scheduleGraphicsOverlay(broadcastState.channelId, broadcastState.gameId)
      return NextResponse.json({ status: "overlay-active" })
    } catch (err: unknown) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Overlay activation failed" },
        { status: 500 }
      )
    }
  }

  const validActions = ["prepare", "go-live", "start", "stop", "destroy-all"]
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${validActions.join(", ")}, activate-overlay` },
      { status: 400 }
    )
  }

  if ((action === "prepare" || action === "start") && !gameId) {
    return NextResponse.json({ error: "gameId is required for prepare/start" }, { status: 400 })
  }

  // If the worker Lambda is configured (production / Amplify), invoke it asynchronously
  // and return immediately — the Lambda runs for up to 14.5 minutes without any HTTP timeout.
  // The client polls GET /api/broadcast to watch DynamoDB-backed step progress.
  if (process.env.BROADCAST_WORKER_FUNCTION_NAME) {
    try {
      await invokeWorkerAsync({ action, ...(gameId ? { gameId } : {}) })
      return NextResponse.json({ status: "queued" })
    } catch (err: unknown) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to invoke worker" },
        { status: 500 }
      )
    }
  }

  // Fallback: run inline via SSE (local dev — no Lambda configured).
  if (action === "prepare")     return makeStream(send => streamPrepare(gameId!, send))
  if (action === "go-live")     return makeStream(send => streamGoLive(send))
  if (action === "start")       return makeStream(send => streamStart(gameId!, send))
  if (action === "stop")        return makeStream(send => streamStop(send))
  return makeStream(send => streamDestroyAll(send))
}
