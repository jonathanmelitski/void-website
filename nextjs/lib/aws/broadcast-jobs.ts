/**
 * Shared broadcast job logic — used by both the Next.js API route (for local dev / SSE)
 * and the Amplify Gen 2 Lambda worker (for production async execution).
 */

import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import {
  createInputSecurityGroup,
  deleteInputSecurityGroup,
  createRtmpInput,
  deleteInput,
  createChannel,
  deleteChannel,
  startChannel,
  stopChannel,
  waitForChannelState,
  scheduleGraphicsOverlay,
  deactivateGraphicsOverlay,
  listVoidChannels,
  listVoidInputs,
  listVoidInputSecurityGroups,
} from "./medialive"
import type { StepDef, StepStatus, StreamEvent } from "../step-types"

// ---- Constants ----

const STREAM_HOSTNAME = "stream.voidultimate.com"
export const JOB_PK = "job"

// ---- AWS clients (lazy — instantiated on first use so env vars are read at runtime) ----

let _r53: Route53Client | null = null
let _dynamo: DynamoDBDocumentClient | null = null

function r53(): Route53Client {
  if (!_r53) {
    _r53 = new Route53Client({
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
        secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
      },
    })
  }
  return _r53
}

function dynamo(): DynamoDBDocumentClient {
  if (!_dynamo) {
    _dynamo = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: process.env.VOID_REGION!,
        credentials: {
          accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
          secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
        },
      })
    )
  }
  return _dynamo
}

const TABLE = () => process.env.DYNAMO_BROADCAST_TABLE!
const HOSTED_ZONE_ID = () => process.env.ROUTE53_HOSTED_ZONE_ID!

// ---- Types ----

export type BroadcastState = {
  pk: "singleton"
  channelId: string
  inputId: string
  securityGroupId: string
  gameId: string
  rtmpUrl: string
  startedAt: string
}

export type JobItem = {
  pk: string
  action: string
  steps: StepDef[]
  startedAt: string
  completedAt?: string
  errorMessage?: string
}

// ---- Broadcast state ----

export async function saveBroadcastState(state: Omit<BroadcastState, "pk">): Promise<void> {
  await dynamo().send(new PutCommand({
    TableName: TABLE(),
    Item: { pk: "singleton", ...state },
  }))
}

export async function getBroadcastState(): Promise<BroadcastState | null> {
  const res = await dynamo().send(new GetCommand({
    TableName: TABLE(),
    Key: { pk: "singleton" },
  }))
  return (res.Item as BroadcastState) ?? null
}

export async function clearBroadcastState(): Promise<void> {
  await dynamo().send(new DeleteCommand({
    TableName: TABLE(),
    Key: { pk: "singleton" },
  }))
}

// ---- Job state ----

export async function saveJob(pk: string, action: string, steps: StepDef[]): Promise<void> {
  await dynamo().send(new PutCommand({
    TableName: TABLE(),
    Item: { pk, action, steps, startedAt: new Date().toISOString() },
  }))
}

export async function patchJobStep(pk: string, id: string, status: StepStatus, error?: string): Promise<void> {
  const res = await dynamo().send(new GetCommand({ TableName: TABLE(), Key: { pk } }))
  const item = res.Item as JobItem | undefined
  if (!item) return
  const steps = item.steps.map(s =>
    s.id === id ? { ...s, status, ...(error ? { error } : {}) } : s
  )
  await dynamo().send(new UpdateCommand({
    TableName: TABLE(),
    Key: { pk },
    UpdateExpression: "SET steps = :steps",
    ExpressionAttributeValues: { ":steps": steps },
  }))
}

export async function completeJob(pk: string): Promise<void> {
  await dynamo().send(new UpdateCommand({
    TableName: TABLE(),
    Key: { pk },
    UpdateExpression: "SET completedAt = :t",
    ExpressionAttributeValues: { ":t": new Date().toISOString() },
  }))
}

export async function failJob(pk: string, message: string): Promise<void> {
  await dynamo().send(new UpdateCommand({
    TableName: TABLE(),
    Key: { pk },
    UpdateExpression: "SET completedAt = :t, errorMessage = :m",
    ExpressionAttributeValues: { ":t": new Date().toISOString(), ":m": message },
  }))
}

export async function getJob(pk: string): Promise<JobItem | null> {
  const res = await dynamo().send(new GetCommand({ TableName: TABLE(), Key: { pk } }))
  return (res.Item as JobItem) ?? null
}

// ---- Route53 ----

export async function upsertStreamDns(ip: string): Promise<void> {
  await r53().send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID(),
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

export async function deleteStreamDns(): Promise<void> {
  const list = await r53().send(new ListResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID(),
    StartRecordName: `${STREAM_HOSTNAME}.`,
    StartRecordType: "A",
    MaxItems: 1,
  }))
  const record = list.ResourceRecordSets?.find(
    r => r.Name === `${STREAM_HOSTNAME}.` && r.Type === "A"
  )
  if (!record) return
  await r53().send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID(),
    ChangeBatch: { Changes: [{ Action: "DELETE", ResourceRecordSet: record }] },
  }))
}

// ---- Step helper ----

export function mkStep(pk: string, send: (e: StreamEvent) => void) {
  return async (id: string, status: StepStatus, error?: string) => {
    send({ type: "step", id, status, ...(error ? { error } : {}) })
    await patchJobStep(pk, id, status, error)
  }
}

// ---- Start ----

export async function streamStart(gameId: string, send: (e: StreamEvent) => void): Promise<void> {
  const steps: StepDef[] = [
    { id: "create-sg",        label: "Create input security group",    status: "pending" },
    { id: "create-input",     label: "Create RTMP input",              status: "pending" },
    { id: "create-channel",   label: "Create channel",                 status: "pending" },
    { id: "wait-idle",        label: "Wait for channel to initialize", status: "pending" },
    { id: "start-channel",    label: "Start channel",                  status: "pending" },
    { id: "wait-running",     label: "Wait for channel to start",      status: "pending" },
    { id: "schedule-overlay", label: "Schedule scoreboard overlay",    status: "pending" },
    { id: "update-dns",       label: "Update DNS",                     status: "pending" },
    { id: "save-state",       label: "Save broadcast state",           status: "pending" },
  ]
  send({ type: "init", steps })
  await saveJob(JOB_PK, "start", steps)
  const step = mkStep(JOB_PK, send)

  const allocated = {
    securityGroupId: null as string | null,
    inputId: null as string | null,
    channelId: null as string | null,
    dnsSet: false,
  }

  try {
    await step("create-sg", "running")
    const securityGroupId = await createInputSecurityGroup()
    allocated.securityGroupId = securityGroupId
    await step("create-sg", "done")

    await step("create-input", "running")
    const { inputId, endpointIp, rtmpUrl } = await createRtmpInput(gameId, securityGroupId)
    allocated.inputId = inputId
    await step("create-input", "done")

    await step("create-channel", "running")
    const channelId = await createChannel(inputId)
    allocated.channelId = channelId
    await step("create-channel", "done")

    await step("wait-idle", "running")
    await waitForChannelState(channelId, "IDLE", 120_000)
    await step("wait-idle", "done")

    await step("start-channel", "running")
    await startChannel(channelId)
    await step("start-channel", "done")

    await step("wait-running", "running")
    await waitForChannelState(channelId, "RUNNING", 200_000)
    await step("wait-running", "done")

    await step("schedule-overlay", "running")
    await scheduleGraphicsOverlay(channelId, gameId)
    await step("schedule-overlay", "done")

    await step("update-dns", "running")
    await upsertStreamDns(endpointIp)
    allocated.dnsSet = true
    await step("update-dns", "done")

    await step("save-state", "running")
    await saveBroadcastState({ channelId, inputId, securityGroupId, gameId, rtmpUrl, startedAt: new Date().toISOString() })
    await step("save-state", "done")

    Object.assign(allocated, { securityGroupId: null, inputId: null, channelId: null, dnsSet: false })

    send({ type: "done" })
    await completeJob(JOB_PK)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    send({ type: "error", message: msg })
    await failJob(JOB_PK, msg)

    if (allocated.dnsSet) { try { await deleteStreamDns() } catch {} }
    if (allocated.channelId) {
      try { await stopChannel(allocated.channelId) } catch {}
      try { await waitForChannelState(allocated.channelId, "IDLE", 60_000) } catch {}
      try { await deleteChannel(allocated.channelId) } catch {}
      try { await waitForChannelState(allocated.channelId, "DELETED", 60_000) } catch {}
    }
    if (allocated.inputId) { try { await deleteInput(allocated.inputId) } catch {} }
    if (allocated.securityGroupId) { try { await deleteInputSecurityGroup(allocated.securityGroupId) } catch {} }
  }
}

// ---- Stop ----

export async function streamStop(send: (e: StreamEvent) => void): Promise<void> {
  const broadcastState = await getBroadcastState()

  if (!broadcastState) {
    send({ type: "init", steps: [] })
    send({ type: "done" })
    return
  }

  const steps: StepDef[] = [
    { id: "deactivate-overlay", label: "Deactivate scoreboard overlay",  status: "pending" },
    { id: "stop-channel",       label: "Stop channel",                   status: "pending" },
    { id: "wait-idle",          label: "Wait for channel to stop",       status: "pending" },
    { id: "delete-channel",     label: "Delete channel",                 status: "pending" },
    { id: "wait-deleted",       label: "Wait for channel deletion",      status: "pending" },
    { id: "delete-input",       label: "Delete RTMP input",              status: "pending" },
    { id: "delete-sg",          label: "Delete input security group",    status: "pending" },
    { id: "delete-dns",         label: "Delete DNS record",              status: "pending" },
    { id: "clear-state",        label: "Clear broadcast state",          status: "pending" },
  ]
  send({ type: "init", steps })
  await saveJob(JOB_PK, "stop", steps)
  const step = mkStep(JOB_PK, send)

  const tryStep = async (id: string, fn: () => Promise<void>) => {
    await step(id, "running")
    try { await fn(); await step(id, "done") }
    catch (e) { await step(id, "error", e instanceof Error ? e.message : String(e)) }
  }

  await tryStep("deactivate-overlay", () => deactivateGraphicsOverlay(broadcastState.channelId))
  await tryStep("stop-channel",       () => stopChannel(broadcastState.channelId))
  await tryStep("wait-idle",          () => waitForChannelState(broadcastState.channelId, "IDLE", 120_000))
  await tryStep("delete-channel",     () => deleteChannel(broadcastState.channelId))
  await tryStep("wait-deleted",       () => waitForChannelState(broadcastState.channelId, "DELETED", 120_000))
  await tryStep("delete-input",       () => deleteInput(broadcastState.inputId))
  await tryStep("delete-sg",          () => deleteInputSecurityGroup(broadcastState.securityGroupId))
  await tryStep("delete-dns",         () => deleteStreamDns())
  await tryStep("clear-state",        () => clearBroadcastState())

  send({ type: "done" })
  await completeJob(JOB_PK)
}

// ---- Destroy All ----

export async function streamDestroyAll(send: (e: StreamEvent) => void): Promise<void> {
  const steps: StepDef[] = [
    { id: "list",            label: "Find all broadcast resources",     status: "pending" },
    { id: "stop-channels",   label: "Stop all running channels",        status: "pending" },
    { id: "wait-idle",       label: "Wait for channels to stop",        status: "pending" },
    { id: "delete-channels", label: "Delete all channels",              status: "pending" },
    { id: "wait-deleted",    label: "Wait for channel deletion",        status: "pending" },
    { id: "delete-inputs",   label: "Delete all RTMP inputs",           status: "pending" },
    { id: "delete-sgs",      label: "Delete all input security groups", status: "pending" },
    { id: "delete-dns",      label: "Delete DNS record",                status: "pending" },
    { id: "clear-state",     label: "Clear broadcast state",            status: "pending" },
  ]
  send({ type: "init", steps })
  await saveJob(JOB_PK, "destroy-all", steps)
  const step = mkStep(JOB_PK, send)

  await step("list", "running")
  let channels: Awaited<ReturnType<typeof listVoidChannels>> = []
  let inputs:   Awaited<ReturnType<typeof listVoidInputs>> = []
  let sgs:      Awaited<ReturnType<typeof listVoidInputSecurityGroups>> = []
  try {
    ;[channels, inputs, sgs] = await Promise.all([
      listVoidChannels(), listVoidInputs(), listVoidInputSecurityGroups(),
    ])
    await step("list", "done")
  } catch (e) {
    await step("list", "error", e instanceof Error ? e.message : String(e))
  }

  const errs = (items: string[]) => items.length ? items.join("; ") : undefined

  await step("stop-channels", "running")
  const stopErrs: string[] = []
  for (const ch of channels.filter(c => c.state === "RUNNING" || c.state === "STARTING")) {
    try { await stopChannel(ch.id) }
    catch (e) { stopErrs.push(`${ch.id}: ${e instanceof Error ? e.message : e}`) }
  }
  await step("stop-channels", stopErrs.length ? "error" : "done", errs(stopErrs))

  await step("wait-idle", "running")
  const idleErrs: string[] = []
  for (const ch of channels) {
    try { await waitForChannelState(ch.id, "IDLE", 120_000) }
    catch (e) { idleErrs.push(`${ch.id}: ${e instanceof Error ? e.message : e}`) }
  }
  await step("wait-idle", idleErrs.length ? "error" : "done", errs(idleErrs))

  await step("delete-channels", "running")
  const delChErrs: string[] = []
  for (const ch of channels) {
    try { await deleteChannel(ch.id) }
    catch (e) { delChErrs.push(`${ch.id}: ${e instanceof Error ? e.message : e}`) }
  }
  await step("delete-channels", delChErrs.length ? "error" : "done", errs(delChErrs))

  await step("wait-deleted", "running")
  const delWaitErrs: string[] = []
  for (const ch of channels) {
    try { await waitForChannelState(ch.id, "DELETED", 120_000) }
    catch (e) { delWaitErrs.push(`${ch.id}: ${e instanceof Error ? e.message : e}`) }
  }
  await step("wait-deleted", delWaitErrs.length ? "error" : "done", errs(delWaitErrs))

  await step("delete-inputs", "running")
  const delInErrs: string[] = []
  for (const inp of inputs) {
    try { await deleteInput(inp.id) }
    catch (e) { delInErrs.push(`${inp.id}: ${e instanceof Error ? e.message : e}`) }
  }
  await step("delete-inputs", delInErrs.length ? "error" : "done", errs(delInErrs))

  await step("delete-sgs", "running")
  const delSgErrs: string[] = []
  for (const sg of sgs) {
    try { await deleteInputSecurityGroup(sg.id) }
    catch (e) { delSgErrs.push(`${sg.id}: ${e instanceof Error ? e.message : e}`) }
  }
  await step("delete-sgs", delSgErrs.length ? "error" : "done", errs(delSgErrs))

  await step("delete-dns", "running")
  try { await deleteStreamDns(); await step("delete-dns", "done") }
  catch (e) { await step("delete-dns", "error", e instanceof Error ? e.message : String(e)) }

  await step("clear-state", "running")
  try { await clearBroadcastState(); await step("clear-state", "done") }
  catch (e) { await step("clear-state", "error", e instanceof Error ? e.message : String(e)) }

  send({ type: "done" })
  await completeJob(JOB_PK)
}
