import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm"
import {
  describeWsInstance,
  getJob,
  associateEipIfNeeded,
  checkHealth,
  streamStart,
  streamStop,
  streamDestroyAll,
  type JobItem,
} from "@/lib/aws/live-server-jobs"
import type { StreamEvent } from "@/lib/step-types"

export const maxDuration = 300 // respected by Vercel; ignored by Amplify (see live-server-worker Lambda)

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
    FunctionName: process.env.LIVE_SERVER_WORKER_FUNCTION_NAME!,
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

// ---- SSM client (logs action only) ----

const ssm = new SSMClient({
  region: process.env.VOID_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

// ---- Types ----

export type LiveServerStatus = "offline" | "starting" | "online" | "unhealthy" | "stopping"

export type LiveServerInfo = {
  status: LiveServerStatus
  instanceId?: string
  publicIp?: string
  health?: { games: number; subscribers: number }
  errors?: string[]
}

// ---- GET /api/live-server ----

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const [instance, job] = await Promise.all([describeWsInstance(), getJob()])

    if (!instance?.State?.Name) {
      return NextResponse.json({ status: "offline", job: job ?? null } satisfies LiveServerInfo & { job: JobItem | null })
    }

    const state = instance.State.Name
    const instanceId = instance.InstanceId
    const eipPublicIp = instance.Tags?.find(t => t.Key === "EipPublicIp")?.Value

    if (state === "pending") {
      return NextResponse.json({ status: "starting", instanceId, publicIp: eipPublicIp, job: job ?? null })
    }
    if (state === "stopping" || state === "shutting-down") {
      return NextResponse.json({ status: "stopping", instanceId, job: job ?? null })
    }
    if (state === "stopped") {
      return NextResponse.json({ status: "offline", instanceId, job: job ?? null })
    }

    if (state === "running") {
      // Lazily associate EIP the first time the instance reaches running state
      await associateEipIfNeeded(instance)

      const ip = eipPublicIp ?? instance.PublicIpAddress
      const health = ip ? await checkHealth(ip) : null

      return NextResponse.json({
        status: health ? "online" : "unhealthy",
        instanceId,
        publicIp: ip,
        ...(health ? { health } : {}),
        job: job ?? null,
      })
    }

    return NextResponse.json({ status: "offline", job: job ?? null })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to describe instance"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ---- POST /api/live-server ----

export async function POST(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { action } = await request.json()

  // ---- LOGS — runs inline, no Lambda needed ----
  if (action === "logs") {
    let instance: Awaited<ReturnType<typeof describeWsInstance>>
    try {
      instance = await describeWsInstance()
    } catch (e: unknown) {
      return NextResponse.json({ error: `Describe failed: ${e instanceof Error ? e.message : e}` }, { status: 500 })
    }
    if (!instance?.InstanceId) {
      return NextResponse.json({ error: "No instance running" }, { status: 404 })
    }

    try {
      const sendRes = await ssm.send(new SendCommandCommand({
        InstanceIds: [instance.InstanceId],
        DocumentName: "AWS-RunShellScript",
        Parameters: {
          commands: [
            "echo '===== cloud-init =====' && tail -200 /var/log/cloud-init-output.log 2>/dev/null || echo '[not found]'",
            "echo '===== ws server =====' && tail -150 /var/log/void-ws.log 2>/dev/null || echo '[not found]'",
          ],
        },
        TimeoutSeconds: 30,
      }))

      const commandId = sendRes.Command!.CommandId!

      // Poll up to 20s for the command to complete
      let output = "Waiting for SSM agent..."
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000))
        try {
          const result = await ssm.send(new GetCommandInvocationCommand({
            CommandId: commandId,
            InstanceId: instance.InstanceId,
          }))
          if (result.Status === "Success" || result.Status === "Failed") {
            output = result.StandardOutputContent ?? "(no output)"
            if (result.StandardErrorContent) output += `\n[stderr]\n${result.StandardErrorContent}`
            break
          }
          if (result.Status === "Cancelled" || result.Status === "TimedOut") {
            output = `Command ${result.Status}`
            break
          }
        } catch { continue }
      }

      return NextResponse.json({ output })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      // Common case: SSM agent not yet registered (instance still booting)
      if (msg.includes("InvalidInstanceId")) {
        return NextResponse.json({ output: "SSM agent not ready yet — instance is still booting. Try again in 30s." })
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  if (action !== "start" && action !== "stop" && action !== "destroy-all") {
    return NextResponse.json({ error: "action must be 'start', 'stop', 'destroy-all', or 'logs'" }, { status: 400 })
  }

  // If the worker Lambda is configured (production / Amplify), invoke it asynchronously
  // and return immediately — the Lambda runs for up to 14.5 minutes without any HTTP timeout.
  // The client polls GET /api/live-server to watch DynamoDB-backed step progress.
  if (process.env.LIVE_SERVER_WORKER_FUNCTION_NAME) {
    try {
      await invokeWorkerAsync({ action })
      return NextResponse.json({ status: "queued" })
    } catch (err: unknown) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to invoke worker" },
        { status: 500 }
      )
    }
  }

  // Fallback: run inline via SSE (local dev — no Lambda configured).
  if (action === "start") return makeStream(send => streamStart(send))
  if (action === "stop")  return makeStream(send => streamStop(send))
  return makeStream(send => streamDestroyAll(send))
}
