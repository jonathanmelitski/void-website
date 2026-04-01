/**
 * Shared live-server job logic — used by both the Next.js API route (local dev / SSE fallback)
 * and the Amplify-independent Lambda worker (production async execution).
 */

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
} from "@aws-sdk/client-ssm"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import type { StepDef, StepStatus, StreamEvent } from "../step-types"

// ---- Constants ----

const WS_HOSTNAME = "live.voidultimate.com"
const SG_NAME = "void-ws-server"
const PURPOSE_TAG = "void-ws-server"
const WS_PORT = 3000

export const WS_JOB_PK = "job-ws"

// ---- Lazy AWS clients ----

let _ec2: EC2Client | null = null
let _r53: Route53Client | null = null
let _ssm: SSMClient | null = null
let _dynamo: DynamoDBDocumentClient | null = null

function creds() {
  return {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  }
}

function ec2() {
  return _ec2 ??= new EC2Client({ region: process.env.VOID_REGION ?? "us-east-1", credentials: creds() })
}
function r53() {
  return _r53 ??= new Route53Client({ region: "us-east-1", credentials: creds() })
}
function ssm() {
  return _ssm ??= new SSMClient({ region: process.env.VOID_REGION ?? "us-east-1", credentials: creds() })
}
function dynamo() {
  return _dynamo ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.VOID_REGION ?? "us-east-1", credentials: creds() })
  )
}

const TABLE = () => process.env.DYNAMO_BROADCAST_TABLE!
const HOSTED_ZONE_ID = () => process.env.ROUTE53_HOSTED_ZONE_ID!
const INSTANCE_TYPE = () => process.env.EC2_INSTANCE_TYPE ?? "t3.micro"

// ---- Types ----

export type JobItem = {
  pk: string
  action: string
  steps: StepDef[]
  startedAt: string
  completedAt?: string
  errorMessage?: string
}

// ---- Job state ----

export async function saveJob(action: string, steps: StepDef[]): Promise<void> {
  await dynamo().send(new PutCommand({
    TableName: TABLE(),
    Item: { pk: WS_JOB_PK, action, steps, startedAt: new Date().toISOString() },
  }))
}

export async function patchJobStep(id: string, status: StepStatus, error?: string): Promise<void> {
  const res = await dynamo().send(new GetCommand({ TableName: TABLE(), Key: { pk: WS_JOB_PK } }))
  const item = res.Item as JobItem | undefined
  if (!item) return
  const steps = item.steps.map(s =>
    s.id === id ? { ...s, status, ...(error ? { error } : {}) } : s
  )
  await dynamo().send(new UpdateCommand({
    TableName: TABLE(),
    Key: { pk: WS_JOB_PK },
    UpdateExpression: "SET steps = :steps",
    ExpressionAttributeValues: { ":steps": steps },
  }))
}

export async function completeJob(): Promise<void> {
  await dynamo().send(new UpdateCommand({
    TableName: TABLE(),
    Key: { pk: WS_JOB_PK },
    UpdateExpression: "SET completedAt = :t",
    ExpressionAttributeValues: { ":t": new Date().toISOString() },
  }))
}

export async function failJob(message: string): Promise<void> {
  await dynamo().send(new UpdateCommand({
    TableName: TABLE(),
    Key: { pk: WS_JOB_PK },
    UpdateExpression: "SET completedAt = :t, errorMessage = :m",
    ExpressionAttributeValues: { ":t": new Date().toISOString(), ":m": message },
  }))
}

export async function getJob(): Promise<JobItem | null> {
  const res = await dynamo().send(new GetCommand({ TableName: TABLE(), Key: { pk: WS_JOB_PK } }))
  return (res.Item as JobItem) ?? null
}

// ---- EC2 helpers ----

export async function describeWsInstance(): Promise<Instance | null> {
  const res = await ec2().send(new DescribeInstancesCommand({
    Filters: [{ Name: "tag:Purpose", Values: [PURPOSE_TAG] }],
  }))
  const all = res.Reservations?.flatMap(r => r.Instances ?? []) ?? []
  return all.find(i => i.State?.Name !== "terminated" && i.State?.Name !== "shutting-down") ?? null
}

export async function checkHealth(ip: string): Promise<{ games: number; subscribers: number } | null> {
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

export async function associateEipIfNeeded(instance: Instance): Promise<void> {
  const eipAllocId = instance.Tags?.find(t => t.Key === "EipAllocationId")?.Value
  const eipPublicIp = instance.Tags?.find(t => t.Key === "EipPublicIp")?.Value
  if (eipAllocId && eipPublicIp && instance.PublicIpAddress !== eipPublicIp) {
    try {
      await ec2().send(new AssociateAddressCommand({ InstanceId: instance.InstanceId, AllocationId: eipAllocId }))
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.toLowerCase().includes("already associated")) {
        console.error("[EC2] AssociateAddress failed:", e)
      }
    }
  }
}

async function waitForInstancesTerminated(instanceIds: string[], timeoutMs = 120_000): Promise<void> {
  if (instanceIds.length === 0) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await ec2().send(new DescribeInstancesCommand({ InstanceIds: instanceIds }))
    const instances = res.Reservations?.flatMap(r => r.Instances ?? []) ?? []
    if (instances.every(i => i.State?.Name === "terminated")) return
    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error("Timed out waiting for instances to terminate")
}

async function getDefaultVpc(): Promise<string> {
  const res = await ec2().send(new DescribeVpcsCommand({
    Filters: [{ Name: "isDefault", Values: ["true"] }],
  }))
  const vpc = res.Vpcs?.[0]
  if (!vpc?.VpcId) throw new Error("No default VPC found")
  return vpc.VpcId
}

async function getDefaultSubnet(vpcId: string): Promise<string> {
  const res = await ec2().send(new DescribeSubnetsCommand({
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
  const existing = await ec2().send(new DescribeSecurityGroupsCommand({
    Filters: [
      { Name: "group-name", Values: [SG_NAME] },
      { Name: "vpc-id", Values: [vpcId] },
    ],
  }))
  const found = existing.SecurityGroups?.[0]?.GroupId
  if (found) return found

  const created = await ec2().send(new CreateSecurityGroupCommand({
    GroupName: SG_NAME,
    Description: "Void WS server - port 3000",
    VpcId: vpcId,
  }))
  const sgId = created.GroupId!

  await ec2().send(new CreateTagsCommand({
    Resources: [sgId],
    Tags: [{ Key: "Purpose", Value: PURPOSE_TAG }],
  }))

  try {
    await ec2().send(new AuthorizeSecurityGroupIngressCommand({
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
    const res = await ssm().send(new GetParameterCommand({
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

async function upsertDns(ip: string): Promise<void> {
  await r53().send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID(),
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

async function deleteDns(): Promise<void> {
  const list = await r53().send(new ListResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID(),
    StartRecordName: `${WS_HOSTNAME}.`,
    StartRecordType: "A",
    MaxItems: 1,
  }))
  const record = list.ResourceRecordSets?.find(r => r.Name === `${WS_HOSTNAME}.` && r.Type === "A")
  if (!record) return
  await r53().send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: HOSTED_ZONE_ID(),
    ChangeBatch: { Changes: [{ Action: "DELETE", ResourceRecordSet: record }] },
  }))
}

// ---- Step helper ----

function mkStep(send: (e: StreamEvent) => void) {
  return async (id: string, status: StepStatus, error?: string) => {
    send({ type: "step", id, status, ...(error ? { error } : {}) })
    await patchJobStep(id, status, error)
  }
}

// ---- Start ----

export async function streamStart(send: (e: StreamEvent) => void): Promise<void> {
  const steps: StepDef[] = [
    { id: "validate", label: "Validate configuration",        status: "pending" },
    { id: "check",    label: "Check for existing instance",   status: "pending" },
    { id: "resolve",  label: "Resolve VPC and AMI",           status: "pending" },
    { id: "sg",       label: "Find or create security group", status: "pending" },
    { id: "eip",      label: "Allocate Elastic IP",           status: "pending" },
    { id: "dns",      label: "Update DNS",                    status: "pending" },
    { id: "launch",   label: "Launch EC2 instance",           status: "pending" },
  ]
  send({ type: "init", steps })
  await saveJob("start", steps)
  const step = mkStep(send)

  await step("validate", "running")
  const missingVars = [
    ["ROUTE53_HOSTED_ZONE_ID", process.env.ROUTE53_HOSTED_ZONE_ID],
    ["WS_INTERNAL_SECRET",     process.env.WS_INTERNAL_SECRET],
    ["EC2_INSTANCE_PROFILE",   process.env.EC2_INSTANCE_PROFILE],
    ["EC2_REPO_URL",           process.env.EC2_REPO_URL],
    ["EC2_GITHUB_TOKEN",       process.env.EC2_GITHUB_TOKEN],
  ].filter(([, v]) => !v).map(([k]) => k)

  if (missingVars.length > 0) {
    const msg = `Missing required env vars: ${missingVars.join(", ")}`
    await step("validate", "error", msg)
    send({ type: "error", message: msg })
    await failJob(msg)
    return
  }
  await step("validate", "done")

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
    await step("resolve", "running")
    const [vpcId, amiId] = await Promise.all([getDefaultVpc(), getLatestUbuntuAmi()])
    const [subnetId, sgId] = await Promise.all([getDefaultSubnet(vpcId), findOrCreateSecurityGroup(vpcId)])
    await step("resolve", "done")

    await step("sg", "done")

    await step("eip", "running")
    const eipRes = await ec2().send(new AllocateAddressCommand({ Domain: "vpc" }))
    const allocationId = eipRes.AllocationId!
    const publicIp = eipRes.PublicIp!
    allocated.eipAllocationId = allocationId
    await ec2().send(new CreateTagsCommand({
      Resources: [allocationId],
      Tags: [
        { Key: "Purpose", Value: PURPOSE_TAG },
        { Key: "Name", Value: "void-ws-server" },
      ],
    }))
    await step("eip", "done")

    await step("dns", "running")
    await upsertDns(publicIp)
    allocated.dnsUpserted = true
    await step("dns", "done")

    await step("launch", "running")
    const repoUrl = process.env.EC2_REPO_URL ?? ""
    const repoBranch = process.env.EC2_REPO_BRANCH ?? "main"
    const githubToken = process.env.EC2_GITHUB_TOKEN ?? ""
    const cloneUrl = repoUrl.replace("https://", `https://${githubToken}@`)

    const envLines = [
      `WS_INTERNAL_SECRET=${process.env.WS_INTERNAL_SECRET ?? ""}`,
      `VOID_REGION=${process.env.VOID_REGION ?? "us-east-1"}`,
      `VOID_ACCESS_KEY_ID=${process.env.VOID_ACCESS_KEY_ID ?? ""}`,
      `VOID_SECRET_ACCESS_KEY=${process.env.VOID_SECRET_ACCESS_KEY ?? ""}`,
      `DYNAMO_GAMES_TABLE=${process.env.DYNAMO_GAMES_TABLE ?? ""}`,
      `DYNAMO_POINTS_TABLE=${process.env.DYNAMO_POINTS_TABLE ?? ""}`,
      `DYNAMO_POINT_EVENTS_TABLE=${process.env.DYNAMO_POINT_EVENTS_TABLE ?? ""}`,
      `DYNAMO_PLAYERS_TABLE=${process.env.DYNAMO_PLAYERS_TABLE ?? ""}`,
      `PORT=${WS_PORT}`,
    ].join("\n")

    const userDataScript = `#!/bin/bash
set -e
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
cd /home/ubuntu
git clone --branch ${repoBranch} --single-branch ${cloneUrl} repo
cd repo/ws
npm install
cat > .env <<'ENVEOF'
${envLines}
ENVEOF
NODE_ENV=production npx tsx server.ts >> /var/log/void-ws.log 2>&1 &`

    await ec2().send(new RunInstancesCommand({
      ImageId: amiId,
      InstanceType: INSTANCE_TYPE() as "t3.micro",
      MinCount: 1,
      MaxCount: 1,
      SecurityGroupIds: [sgId],
      SubnetId: subnetId,
      IamInstanceProfile: { Name: process.env.EC2_INSTANCE_PROFILE! },
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
      try { await ec2().send(new ReleaseAddressCommand({ AllocationId: allocated.eipAllocationId })) } catch {}
    }
  }
}

// ---- Stop ----

export async function streamStop(send: (e: StreamEvent) => void): Promise<void> {
  const steps: StepDef[] = [
    { id: "describe",     label: "Describe instance",  status: "pending" },
    { id: "disassoc-eip", label: "Disassociate EIP",   status: "pending" },
    { id: "release-eip",  label: "Release EIP",        status: "pending" },
    { id: "terminate",    label: "Terminate instance", status: "pending" },
    { id: "delete-dns",   label: "Delete DNS record",  status: "pending" },
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
    const addrRes = await ec2().send(new DescribeAddressesCommand({
      Filters: [{ Name: "allocation-id", Values: [eipAllocId] }],
    }))
    const assocId = addrRes.Addresses?.[0]?.AssociationId
    if (assocId) await ec2().send(new DisassociateAddressCommand({ AssociationId: assocId }))
  })

  await tryStep("release-eip", async () => {
    if (!eipAllocId) return
    await ec2().send(new ReleaseAddressCommand({ AllocationId: eipAllocId }))
  })

  await tryStep("terminate", () =>
    ec2().send(new TerminateInstancesCommand({ InstanceIds: [instance!.InstanceId!] })).then(() => {})
  )

  await tryStep("delete-dns", () => deleteDns())

  send({ type: "done" })
  await completeJob()
}

// ---- Destroy All ----

export async function streamDestroyAll(send: (e: StreamEvent) => void): Promise<void> {
  const steps: StepDef[] = [
    { id: "find-instances",  label: "Find all tagged instances",       status: "pending" },
    { id: "terminate",       label: "Terminate all instances",         status: "pending" },
    { id: "wait-terminated", label: "Wait for instances to terminate", status: "pending" },
    { id: "find-eips",       label: "Find all tagged EIPs",            status: "pending" },
    { id: "release-eips",    label: "Release all EIPs",                status: "pending" },
    { id: "delete-sg",       label: "Delete security group",           status: "pending" },
    { id: "delete-dns",      label: "Delete DNS record",               status: "pending" },
  ]
  send({ type: "init", steps })
  await saveJob("destroy-all", steps)
  const step = mkStep(send)

  await step("find-instances", "running")
  let toTerminate: string[] = []
  try {
    const res = await ec2().send(new DescribeInstancesCommand({
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
      await ec2().send(new TerminateInstancesCommand({ InstanceIds: toTerminate }))
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

  await step("find-eips", "running")
  let eipAddresses: { AllocationId?: string; AssociationId?: string }[] = []
  try {
    const res = await ec2().send(new DescribeAddressesCommand({
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
      try { await ec2().send(new DisassociateAddressCommand({ AssociationId: addr.AssociationId })) } catch {}
    }
    if (addr.AllocationId) {
      try { await ec2().send(new ReleaseAddressCommand({ AllocationId: addr.AllocationId })) }
      catch (e) { eipErrs.push(`${addr.AllocationId}: ${e instanceof Error ? e.message : e}`) }
    }
  }
  await step("release-eips", eipErrs.length ? "error" : "done", eipErrs.join("; ") || undefined)

  await step("delete-sg", "running")
  try {
    const vpcId = await getDefaultVpc()
    const sgRes = await ec2().send(new DescribeSecurityGroupsCommand({
      Filters: [{ Name: "group-name", Values: [SG_NAME] }, { Name: "vpc-id", Values: [vpcId] }],
    }))
    const sgId = sgRes.SecurityGroups?.[0]?.GroupId
    if (sgId) await ec2().send(new DeleteSecurityGroupCommand({ GroupId: sgId }))
    await step("delete-sg", "done")
  } catch (e) {
    await step("delete-sg", "error", e instanceof Error ? e.message : String(e))
  }

  await step("delete-dns", "running")
  try { await deleteDns(); await step("delete-dns", "done") }
  catch (e) { await step("delete-dns", "error", e instanceof Error ? e.message : String(e)) }

  send({ type: "done" })
  await completeJob()
}
