import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { StepDef, StepStatus, StreamEvent } from "@/lib/step-types"

export const maxDuration = 300
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeAddressesCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DeleteSecurityGroupCommand,
  CreateTagsCommand,
  RunInstancesCommand,
  TerminateInstancesCommand,
  AllocateAddressCommand,
  AssociateAddressCommand,
  DisassociateAddressCommand,
  ReleaseAddressCommand,
  type Instance,
} from "@aws-sdk/client-ec2"
import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53"
import {
  SSMClient,
  GetParameterCommand,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm"

// ---- Constants ----

const REGION = process.env.VOID_REGION ?? "us-east-1"
const INSTANCE_TYPE = process.env.EC2_INSTANCE_TYPE ?? "t3.micro"

const CREDENTIALS = {
  accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
  secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
}
const HOSTED_ZONE_ID = process.env.ROUTE53_HOSTED_ZONE_ID!
const REPO_URL = process.env.EC2_REPO_URL ?? ""
const REPO_BRANCH = process.env.EC2_REPO_BRANCH ?? "main"
const GITHUB_TOKEN = process.env.EC2_GITHUB_TOKEN ?? ""
const WS_HOSTNAME = "live.voidultimate.com"
const SG_NAME = "void-ws-server"
const PURPOSE_TAG = "void-ws-server"
const WS_PORT = 3000

const BROADCAST_TABLE = process.env.DYNAMO_BROADCAST_TABLE!
const WS_JOB_PK = "job-ws"

// ---- DynamoDB client ----

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION, credentials: CREDENTIALS })
)

// ---- Job state helpers ----

type JobItem = {
  pk: string
  action: string
  steps: StepDef[]
  startedAt: string
  completedAt?: string
  errorMessage?: string
}

async function saveJob(action: string, steps: StepDef[]): Promise<void> {
  await dynamo.send(new PutCommand({
    TableName: BROADCAST_TABLE,
    Item: { pk: WS_JOB_PK, action, steps, startedAt: new Date().toISOString() },
  }))
}

async function patchJobStep(id: string, status: StepStatus, error?: string): Promise<void> {
  const res = await dynamo.send(new GetCommand({ TableName: BROADCAST_TABLE, Key: { pk: WS_JOB_PK } }))
  const item = res.Item as JobItem | undefined
  if (!item) return
  const steps = item.steps.map(s =>
    s.id === id ? { ...s, status, ...(error ? { error } : {}) } : s
  )
  await dynamo.send(new UpdateCommand({
    TableName: BROADCAST_TABLE,
    Key: { pk: WS_JOB_PK },
    UpdateExpression: "SET steps = :steps",
    ExpressionAttributeValues: { ":steps": steps },
  }))
}

async function completeJob(): Promise<void> {
  await dynamo.send(new UpdateCommand({
    TableName: BROADCAST_TABLE,
    Key: { pk: WS_JOB_PK },
    UpdateExpression: "SET completedAt = :t",
    ExpressionAttributeValues: { ":t": new Date().toISOString() },
  }))
}

async function failJob(message: string): Promise<void> {
  await dynamo.send(new UpdateCommand({
    TableName: BROADCAST_TABLE,
    Key: { pk: WS_JOB_PK },
    UpdateExpression: "SET completedAt = :t, errorMessage = :m",
    ExpressionAttributeValues: { ":t": new Date().toISOString(), ":m": message },
  }))
}

async function getJob(): Promise<JobItem | null> {
  const res = await dynamo.send(new GetCommand({ TableName: BROADCAST_TABLE, Key: { pk: WS_JOB_PK } }))
  return (res.Item as JobItem) ?? null
}

// ---- Types ----

export type LiveServerStatus = "offline" | "starting" | "online" | "unhealthy" | "stopping"

export type LiveServerInfo = {
  status: LiveServerStatus
  instanceId?: string
  publicIp?: string
  health?: { games: number; subscribers: number }
  errors?: string[]
}

// ---- SSE helpers ----

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

function mkStep(send: (e: StreamEvent) => void) {
  return async (id: string, status: StepStatus, error?: string) => {
    send({ type: "step", id, status, ...(error ? { error } : {}) })
    await patchJobStep(id, status, error)
  }
}

// ---- AWS clients ----

const ec2 = new EC2Client({ region: REGION, credentials: CREDENTIALS })
const r53 = new Route53Client({ region: "us-east-1", credentials: CREDENTIALS }) // Route53 is global
const ssm = new SSMClient({ region: REGION, credentials: CREDENTIALS })

// ---- EC2 helpers ----

async function waitForInstancesTerminated(instanceIds: string[], timeoutMs = 120_000): Promise<void> {
  if (instanceIds.length === 0) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await ec2.send(new DescribeInstancesCommand({ InstanceIds: instanceIds }))
    const instances = res.Reservations?.flatMap(r => r.Instances ?? []) ?? []
    const allDone = instances.every(i => i.State?.Name === "terminated")
    if (allDone) return
    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error("Timed out waiting for instances to terminate")
}

async function describeWsInstance(): Promise<Instance | null> {
  const res = await ec2.send(new DescribeInstancesCommand({
    Filters: [{ Name: "tag:Purpose", Values: [PURPOSE_TAG] }],
  }))
  const all = res.Reservations?.flatMap(r => r.Instances ?? []) ?? []
  return all.find(i => i.State?.Name !== "terminated" && i.State?.Name !== "shutting-down") ?? null
}

async function getDefaultVpc(): Promise<string> {
  const res = await ec2.send(new DescribeVpcsCommand({
    Filters: [{ Name: "isDefault", Values: ["true"] }],
  }))
  const vpc = res.Vpcs?.[0]
  if (!vpc?.VpcId) throw new Error("No default VPC found")
  return vpc.VpcId
}

async function getDefaultSubnet(vpcId: string): Promise<string> {
  const res = await ec2.send(new DescribeSubnetsCommand({
    Filters: [
      { Name: "vpc-id", Values: [vpcId] },
      { Name: "defaultForAz", Values: ["true"] },
    ],
  }))
  const subnet = res.Subnets?.[0]
  if (!subnet?.SubnetId) throw new Error("No default subnet found")
  return subnet.SubnetId
}

async function findOrCreateSecurityGroup(vpcId: string): Promise<string> {
  const existing = await ec2.send(new DescribeSecurityGroupsCommand({
    Filters: [
      { Name: "group-name", Values: [SG_NAME] },
      { Name: "vpc-id", Values: [vpcId] },
    ],
  }))
  const found = existing.SecurityGroups?.[0]?.GroupId
  if (found) return found

  const created = await ec2.send(new CreateSecurityGroupCommand({
    GroupName: SG_NAME,
    Description: "Void WS server - port 3000",
    VpcId: vpcId,
  }))
  const sgId = created.GroupId!

  // Tag the SG so it's discoverable in destroy-all
  await ec2.send(new CreateTagsCommand({
    Resources: [sgId],
    Tags: [{ Key: "Purpose", Value: PURPOSE_TAG }],
  }))

  try {
    await ec2.send(new AuthorizeSecurityGroupIngressCommand({
      GroupId: sgId,
      IpPermissions: [{
        IpProtocol: "tcp",
        FromPort: WS_PORT,
        ToPort: WS_PORT,
        IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "WebSocket / push" }],
      }],
    }))
  } catch (e: unknown) {
    if (!(e instanceof Error) || !e.message.includes("InvalidPermission.Duplicate")) throw e
  }

  return sgId
}

async function getLatestUbuntuAmi(): Promise<string> {
  try {
    const res = await ssm.send(new GetParameterCommand({
      Name: "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id",
    }))
    return res.Parameter!.Value!
  } catch {
    const fallback = process.env.EC2_AMI_ID
    if (!fallback) throw new Error("Could not resolve Ubuntu AMI — set EC2_AMI_ID as fallback")
    return fallback
  }
}

// ---- Route53 helpers ----

async function upsertDns(ip: string) {
  await r53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID,
    ChangeBatch: {
      Changes: [{
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: `${WS_HOSTNAME}.`,
          Type: "A",
          TTL: 60,
          ResourceRecords: [{ Value: ip }],
        },
      }],
    },
  }))
}

async function deleteDns() {
  const list = await r53.send(new ListResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID,
    StartRecordName: `${WS_HOSTNAME}.`,
    StartRecordType: "A",
    MaxItems: 1,
  }))
  const record = list.ResourceRecordSets?.find(r => r.Name === `${WS_HOSTNAME}.` && r.Type === "A")
  if (!record) return
  await r53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID,
    ChangeBatch: { Changes: [{ Action: "DELETE", ResourceRecordSet: record }] },
  }))
}

// ---- Health check ----

async function checkHealth(ip: string): Promise<{ games: number; subscribers: number } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`http://${ip}:${WS_PORT}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
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
    const eipAllocId = instance.Tags?.find(t => t.Key === "EipAllocationId")?.Value
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
      if (eipAllocId && eipPublicIp && instance.PublicIpAddress !== eipPublicIp) {
        try {
          await ec2.send(new AssociateAddressCommand({ InstanceId: instanceId, AllocationId: eipAllocId }))
        } catch (e: unknown) {
          if (!(e instanceof Error) || !e.message.toLowerCase().includes("already associated")) {
            console.error("[EC2] AssociateAddress failed:", e)
          }
        }
      }

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

// ---- Streaming action implementations ----

async function streamStart(send: (e: StreamEvent) => void) {
  const steps: StepDef[] = [
    { id: "validate",   label: "Validate configuration",              status: "pending" },
    { id: "check",      label: "Check for existing instance",         status: "pending" },
    { id: "resolve",    label: "Resolve VPC and AMI",                 status: "pending" },
    { id: "sg",         label: "Find or create security group",       status: "pending" },
    { id: "eip",        label: "Allocate Elastic IP",                 status: "pending" },
    { id: "dns",        label: "Update DNS",                          status: "pending" },
    { id: "launch",     label: "Launch EC2 instance",                 status: "pending" },
  ]
  send({ type: "init", steps })
  await saveJob("start", steps)
  const step = mkStep(send)

  // Validate
  await step("validate", "running")
  const missingVars = [
    ["ROUTE53_HOSTED_ZONE_ID", HOSTED_ZONE_ID],
    ["WS_INTERNAL_SECRET", process.env.WS_INTERNAL_SECRET],
    ["EC2_INSTANCE_PROFILE", process.env.EC2_INSTANCE_PROFILE],
    ["EC2_REPO_URL", REPO_URL],
    ["EC2_GITHUB_TOKEN", GITHUB_TOKEN],
  ].filter(([, v]) => !v).map(([k]) => k)
  if (missingVars.length > 0) {
    await step("validate", "error", `Missing env vars: ${missingVars.join(", ")}`)
    const msg = `Missing required env vars: ${missingVars.join(", ")}`
    send({ type: "error", message: msg })
    await failJob(msg)
    return
  }
  await step("validate", "done")

  // Check for existing instance
  await step("check", "running")
  let existing: Instance | null = null
  try {
    existing = await describeWsInstance()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await step("check", "error", msg)
    send({ type: "error", message: "Failed to describe instances" })
    await failJob("Failed to describe instances")
    return
  }
  if (existing?.State?.Name === "running" || existing?.State?.Name === "pending") {
    await step("check", "done")
    for (const id of ["resolve", "sg", "eip", "dns", "launch"]) await step(id, "done")
    send({ type: "done" })
    await completeJob()
    return
  }
  await step("check", "done")

  const allocated = { eipAllocationId: null as string | null, dnsUpserted: false }

  try {
    // Resolve VPC + AMI
    await step("resolve", "running")
    const [vpcId, amiId] = await Promise.all([getDefaultVpc(), getLatestUbuntuAmi()])
    const [subnetId, sgId] = await Promise.all([getDefaultSubnet(vpcId), findOrCreateSecurityGroup(vpcId)])
    await step("resolve", "done")

    // Security group (already found/created above)
    await step("sg", "done")

    // Allocate EIP
    await step("eip", "running")
    const eipRes = await ec2.send(new AllocateAddressCommand({ Domain: "vpc" }))
    const allocationId = eipRes.AllocationId!
    const publicIp = eipRes.PublicIp!
    allocated.eipAllocationId = allocationId
    await ec2.send(new CreateTagsCommand({
      Resources: [allocationId],
      Tags: [
        { Key: "Purpose", Value: PURPOSE_TAG },
        { Key: "Name", Value: "void-ws-server" },
      ],
    }))
    await step("eip", "done")

    // Update DNS
    await step("dns", "running")
    await upsertDns(publicIp)
    allocated.dnsUpserted = true
    await step("dns", "done")

    // Launch
    await step("launch", "running")
    const envLines = [
      `WS_INTERNAL_SECRET=${process.env.WS_INTERNAL_SECRET ?? ""}`,
      `VOID_REGION=${REGION}`,
      `VOID_ACCESS_KEY_ID=${process.env.VOID_ACCESS_KEY_ID ?? ""}`,
      `VOID_SECRET_ACCESS_KEY=${process.env.VOID_SECRET_ACCESS_KEY ?? ""}`,
      `DYNAMO_GAMES_TABLE=${process.env.DYNAMO_GAMES_TABLE ?? ""}`,
      `DYNAMO_POINTS_TABLE=${process.env.DYNAMO_POINTS_TABLE ?? ""}`,
      `DYNAMO_POINT_EVENTS_TABLE=${process.env.DYNAMO_POINT_EVENTS_TABLE ?? ""}`,
      `DYNAMO_PLAYERS_TABLE=${process.env.DYNAMO_PLAYERS_TABLE ?? ""}`,
      `PORT=${WS_PORT}`,
    ].join("\n")

    const cloneUrl = REPO_URL.replace("https://", `https://${GITHUB_TOKEN}@`)
    const userDataScript = `#!/bin/bash
set -e
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
cd /home/ubuntu
git clone --branch ${REPO_BRANCH} --single-branch ${cloneUrl} repo
cd repo/ws
npm install
cat > .env <<'ENVEOF'
${envLines}
ENVEOF
NODE_ENV=production npx tsx server.ts >> /var/log/void-ws.log 2>&1 &`

    const instanceProfile = process.env.EC2_INSTANCE_PROFILE!
    await ec2.send(new RunInstancesCommand({
      ImageId: amiId,
      InstanceType: INSTANCE_TYPE as "t3.micro",
      MinCount: 1,
      MaxCount: 1,
      SecurityGroupIds: [sgId],
      SubnetId: subnetId,
      IamInstanceProfile: { Name: instanceProfile },
      UserData: Buffer.from(userDataScript).toString("base64"),
      TagSpecifications: [{
        ResourceType: "instance",
        Tags: [
          { Key: "Purpose", Value: PURPOSE_TAG },
          { Key: "Name", Value: "void-ws-server" },
          { Key: "EipAllocationId", Value: allocationId },
          { Key: "EipPublicIp", Value: publicIp },
        ],
      }],
    }))
    await step("launch", "done")

    allocated.eipAllocationId = null
    allocated.dnsUpserted = false
    send({ type: "done" })
    await completeJob()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    send({ type: "error", message: msg })
    await failJob(msg)
    if (allocated.dnsUpserted) { try { await deleteDns() } catch {} }
    if (allocated.eipAllocationId) {
      try { await ec2.send(new ReleaseAddressCommand({ AllocationId: allocated.eipAllocationId })) } catch {}
    }
  }
}

async function streamStop(send: (e: StreamEvent) => void) {
  const steps: StepDef[] = [
    { id: "describe",      label: "Describe instance",     status: "pending" },
    { id: "disassoc-eip",  label: "Disassociate EIP",      status: "pending" },
    { id: "release-eip",   label: "Release EIP",           status: "pending" },
    { id: "terminate",     label: "Terminate instance",    status: "pending" },
    { id: "delete-dns",    label: "Delete DNS record",     status: "pending" },
  ]
  send({ type: "init", steps })
  await saveJob("stop", steps)
  const step = mkStep(send)

  const tryStep = async (id: string, fn: () => Promise<void>) => {
    await step(id, "running")
    try { await fn(); await step(id, "done") }
    catch (e) { await step(id, "error", e instanceof Error ? e.message : String(e)) }
  }

  await step("describe", "running")
  let instance: Instance | null
  try {
    instance = await describeWsInstance()
    await step("describe", "done")
  } catch (e) {
    await step("describe", "error", e instanceof Error ? e.message : String(e))
    send({ type: "error", message: "Failed to describe instance" })
    await failJob("Failed to describe instance")
    return
  }

  if (!instance?.InstanceId) {
    for (const id of ["disassoc-eip", "release-eip", "terminate", "delete-dns"]) await step(id, "done")
    send({ type: "done" })
    await completeJob()
    return
  }

  const eipAllocId = instance.Tags?.find(t => t.Key === "EipAllocationId")?.Value

  await tryStep("disassoc-eip", async () => {
    if (!eipAllocId) return
    const addrRes = await ec2.send(new DescribeAddressesCommand({
      Filters: [{ Name: "allocation-id", Values: [eipAllocId] }],
    }))
    const assocId = addrRes.Addresses?.[0]?.AssociationId
    if (assocId) await ec2.send(new DisassociateAddressCommand({ AssociationId: assocId }))
  })

  await tryStep("release-eip", async () => {
    if (!eipAllocId) return
    await ec2.send(new ReleaseAddressCommand({ AllocationId: eipAllocId }))
  })

  await tryStep("terminate", () =>
    ec2.send(new TerminateInstancesCommand({ InstanceIds: [instance!.InstanceId!] })).then(() => {})
  )

  await tryStep("delete-dns", () => deleteDns())

  send({ type: "done" })
  await completeJob()
}

async function streamDestroyAll(send: (e: StreamEvent) => void) {
  const steps: StepDef[] = [
    { id: "find-instances",   label: "Find all tagged instances",          status: "pending" },
    { id: "terminate",        label: "Terminate all instances",            status: "pending" },
    { id: "wait-terminated",  label: "Wait for instances to terminate",    status: "pending" },
    { id: "find-eips",        label: "Find all tagged EIPs",               status: "pending" },
    { id: "release-eips",     label: "Release all EIPs",                   status: "pending" },
    { id: "delete-sg",        label: "Delete security group",              status: "pending" },
    { id: "delete-dns",       label: "Delete DNS record",                  status: "pending" },
  ]
  send({ type: "init", steps })
  await saveJob("destroy-all", steps)
  const step = mkStep(send)

  // Find + terminate instances
  await step("find-instances", "running")
  let toTerminate: string[] = []
  try {
    const res = await ec2.send(new DescribeInstancesCommand({
      Filters: [{ Name: "tag:Purpose", Values: [PURPOSE_TAG] }],
    }))
    toTerminate = (res.Reservations?.flatMap(r => r.Instances ?? []) ?? [])
      .filter(i => i.InstanceId && i.State?.Name !== "terminated" && i.State?.Name !== "shutting-down")
      .map(i => i.InstanceId!)
    await step("find-instances", "done")
  } catch (e) {
    await step("find-instances", "error", e instanceof Error ? e.message : String(e))
  }

  await step("terminate", "running")
  try {
    if (toTerminate.length > 0) {
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: toTerminate }))
    }
    await step("terminate", "done")
  } catch (e) {
    await step("terminate", "error", e instanceof Error ? e.message : String(e))
  }

  await step("wait-terminated", "running")
  try {
    await waitForInstancesTerminated(toTerminate)
    await step("wait-terminated", "done")
  } catch (e) {
    await step("wait-terminated", "error", e instanceof Error ? e.message : String(e))
  }

  // Find + release EIPs
  await step("find-eips", "running")
  let eipAddresses: { AllocationId?: string; AssociationId?: string }[] = []
  try {
    const res = await ec2.send(new DescribeAddressesCommand({
      Filters: [{ Name: "tag:Purpose", Values: [PURPOSE_TAG] }],
    }))
    eipAddresses = res.Addresses ?? []
    await step("find-eips", "done")
  } catch (e) {
    await step("find-eips", "error", e instanceof Error ? e.message : String(e))
  }

  await step("release-eips", "running")
  const eipErrs: string[] = []
  for (const addr of eipAddresses) {
    if (addr.AssociationId) {
      try { await ec2.send(new DisassociateAddressCommand({ AssociationId: addr.AssociationId })) } catch {}
    }
    if (addr.AllocationId) {
      try { await ec2.send(new ReleaseAddressCommand({ AllocationId: addr.AllocationId })) }
      catch (e) { eipErrs.push(`${addr.AllocationId}: ${e instanceof Error ? e.message : e}`) }
    }
  }
  await step("release-eips", eipErrs.length ? "error" : "done", eipErrs.join("; ") || undefined)

  // Delete SG
  await step("delete-sg", "running")
  try {
    const vpcId = await getDefaultVpc()
    const sgRes = await ec2.send(new DescribeSecurityGroupsCommand({
      Filters: [{ Name: "group-name", Values: [SG_NAME] }, { Name: "vpc-id", Values: [vpcId] }],
    }))
    const sgId = sgRes.SecurityGroups?.[0]?.GroupId
    if (sgId) await ec2.send(new DeleteSecurityGroupCommand({ GroupId: sgId }))
    await step("delete-sg", "done")
  } catch (e) {
    await step("delete-sg", "error", e instanceof Error ? e.message : String(e))
  }

  // Delete DNS
  await step("delete-dns", "running")
  try { await deleteDns(); await step("delete-dns", "done") }
  catch (e) { await step("delete-dns", "error", e instanceof Error ? e.message : String(e)) }

  send({ type: "done" })
  await completeJob()
}

// ---- POST /api/live-server ----

export async function POST(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { action } = await request.json()

  if (action === "start")       return makeStream(send => streamStart(send))
  if (action === "stop")        return makeStream(send => streamStop(send))
  if (action === "destroy-all") return makeStream(send => streamDestroyAll(send))

  // ---- LOGS ----
  if (action === "logs") {
    let instance: Instance | null
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

  return NextResponse.json({ error: "action must be 'start', 'stop', 'destroy-all', or 'logs'" }, { status: 400 })
}
