import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import {
  createInputSecurityGroup,
  deleteInputSecurityGroup,
  createRtmpInput,
  deleteInput,
  createChannel,
  deleteChannel,
  startChannel,
  stopChannel,
  getChannelStatus,
  waitForChannelState,
  scheduleGraphicsOverlay,
  deactivateGraphicsOverlay,
  destroyAll,
  type ChannelState,
} from "@/lib/aws/medialive"
import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb"

export const maxDuration = 300

// ---- Constants ----

const CREDENTIALS = {
  accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
  secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
}
const HOSTED_ZONE_ID = process.env.ROUTE53_HOSTED_ZONE_ID!
const BROADCAST_TABLE = process.env.DYNAMO_BROADCAST_TABLE!
const STREAM_HOSTNAME = "stream.voidultimate.com"

// ---- AWS clients ----

const r53 = new Route53Client({ region: "us-east-1", credentials: CREDENTIALS })

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.VOID_REGION!, credentials: CREDENTIALS })
)

// ---- Broadcast state (DynamoDB singleton) ----

type BroadcastState = {
  pk: "singleton"
  channelId: string
  inputId: string
  securityGroupId: string
  gameId: string
  rtmpUrl: string
  startedAt: string
}

async function saveBroadcastState(state: Omit<BroadcastState, "pk">): Promise<void> {
  await dynamo.send(new PutCommand({
    TableName: BROADCAST_TABLE,
    Item: { pk: "singleton", ...state },
  }))
}

async function getBroadcastState(): Promise<BroadcastState | null> {
  const res = await dynamo.send(new GetCommand({
    TableName: BROADCAST_TABLE,
    Key: { pk: "singleton" },
  }))
  return (res.Item as BroadcastState) ?? null
}

async function clearBroadcastState(): Promise<void> {
  await dynamo.send(new DeleteCommand({
    TableName: BROADCAST_TABLE,
    Key: { pk: "singleton" },
  }))
}

// ---- Route53 A record for stream.voidultimate.com ----

async function upsertStreamDns(ip: string): Promise<void> {
  await r53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID,
    ChangeBatch: {
      Changes: [{
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: `${STREAM_HOSTNAME}.`,
          Type: "A",
          TTL: 60,
          ResourceRecords: [{ Value: ip }],
        },
      }],
    },
  }))
}

async function deleteStreamDns(): Promise<void> {
  const list = await r53.send(new ListResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID,
    StartRecordName: `${STREAM_HOSTNAME}.`,
    StartRecordType: "A",
    MaxItems: 1,
  }))
  const record = list.ResourceRecordSets?.find(
    r => r.Name === `${STREAM_HOSTNAME}.` && r.Type === "A"
  )
  if (!record) return
  await r53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID,
    ChangeBatch: { Changes: [{ Action: "DELETE", ResourceRecordSet: record }] },
  }))
}

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

// ---- GET /api/broadcast ----

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const broadcastState = await getBroadcastState()

    let channelState: ChannelState = "IDLE"
    if (broadcastState?.channelId) {
      channelState = await getChannelStatus(broadcastState.channelId)
    }

    return NextResponse.json({
      state: channelState,
      channelId: broadcastState?.channelId ?? null,
      inputId: broadcastState?.inputId ?? null,
      rtmpUrl: broadcastState?.rtmpUrl ?? null,
      gameId: broadcastState?.gameId ?? null,
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

  // ---- START ----
  if (action === "start") {
    if (!gameId) {
      return NextResponse.json({ error: "gameId is required" }, { status: 400 })
    }

    const allocated = {
      securityGroupId: null as string | null,
      inputId: null as string | null,
      channelId: null as string | null,
      dnsSet: false,
    }

    try {
      // 1. Create input security group
      const securityGroupId = await createInputSecurityGroup()
      allocated.securityGroupId = securityGroupId

      // 2. Create RTMP push input — game ID is the stream key
      const { inputId, endpointIp, rtmpUrl } = await createRtmpInput(gameId, securityGroupId)
      allocated.inputId = inputId

      // 3. Create MediaLive channel from voidchannel config, wired to this input
      const channelId = await createChannel(inputId)
      allocated.channelId = channelId

      // 4. Wait for channel to finish provisioning before starting
      await waitForChannelState(channelId, "IDLE")

      // 5. Start the channel
      await startChannel(channelId)

      // 5. Point stream.voidultimate.com → MediaLive RTMP endpoint IP
      await upsertStreamDns(endpointIp)
      allocated.dnsSet = true

      // 6. Persist state for activate-overlay and stop paths
      await saveBroadcastState({
        channelId,
        inputId,
        securityGroupId,
        gameId,
        rtmpUrl,
        startedAt: new Date().toISOString(),
      })

      // Return 202 — UI polls GET and calls activate-overlay once state === RUNNING
      return NextResponse.json(
        { status: "starting", rtmpUrl, gameId },
        { status: 202 }
      )
    } catch (err: unknown) {
      // Best-effort rollback in dependency order
      if (allocated.dnsSet) { try { await deleteStreamDns() } catch {} }
      if (allocated.channelId) {
        try { await stopChannel(allocated.channelId) } catch {}
        try { await waitForChannelState(allocated.channelId, "IDLE", 60_000) } catch {}
        try { await deleteChannel(allocated.channelId) } catch {}
        try { await waitForChannelState(allocated.channelId, "DELETED", 60_000) } catch {}
      }
      if (allocated.inputId) { try { await deleteInput(allocated.inputId) } catch {} }
      if (allocated.securityGroupId) {
        try { await deleteInputSecurityGroup(allocated.securityGroupId) } catch {}
      }

      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Start failed" },
        { status: 500 }
      )
    }
  }

  // ---- ACTIVATE OVERLAY ----
  // Called by the UI once it observes the channel reaching RUNNING
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

  // ---- STOP ----
  if (action === "stop") {
    const broadcastState = await getBroadcastState()
    const errors: string[] = []

    if (broadcastState?.channelId) {
      // 1. Deactivate overlay (best-effort)
      try { await deactivateGraphicsOverlay(broadcastState.channelId) } catch {}

      // 2. Stop channel
      try { await stopChannel(broadcastState.channelId) } catch (e) {
        errors.push(`Stop: ${e instanceof Error ? e.message : e}`)
      }

      // 3. Wait for IDLE
      try { await waitForChannelState(broadcastState.channelId, "IDLE", 120_000) } catch (e) {
        errors.push(`Wait IDLE: ${e instanceof Error ? e.message : e}`)
      }

      // 4. Delete channel
      try { await deleteChannel(broadcastState.channelId) } catch (e) {
        errors.push(`Delete channel: ${e instanceof Error ? e.message : e}`)
      }

      // 5. Wait for DELETED before releasing input
      try { await waitForChannelState(broadcastState.channelId, "DELETED", 120_000) } catch (e) {
        errors.push(`Wait DELETED: ${e instanceof Error ? e.message : e}`)
      }
    }

    // 6. Delete input (only after channel is gone)
    if (broadcastState?.inputId) {
      try { await deleteInput(broadcastState.inputId) } catch (e) {
        errors.push(`Delete input: ${e instanceof Error ? e.message : e}`)
      }
    }

    // 7. Delete security group (only after input is gone)
    if (broadcastState?.securityGroupId) {
      try { await deleteInputSecurityGroup(broadcastState.securityGroupId) } catch (e) {
        errors.push(`Delete SG: ${e instanceof Error ? e.message : e}`)
      }
    }

    // 8. Clean up DNS and state
    try { await deleteStreamDns() } catch {}
    try { await clearBroadcastState() } catch {}

    return NextResponse.json({ status: "stopped", ...(errors.length ? { errors } : {}) })
  }

  // ---- DESTROY ALL ----
  if (action === "destroy-all") {
    try { await deleteStreamDns() } catch {}
    try { await clearBroadcastState() } catch {}

    const result = await destroyAll()
    return NextResponse.json({ status: "destroyed", ...result })
  }

  return NextResponse.json(
    { error: "action must be 'start', 'activate-overlay', 'stop', or 'destroy-all'" },
    { status: 400 }
  )
}
