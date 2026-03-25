import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
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

// ---- Types ----

export type LiveServerStatus = "offline" | "starting" | "online" | "unhealthy" | "stopping"

export type LiveServerInfo = {
  status: LiveServerStatus
  instanceId?: string
  publicIp?: string
  health?: { games: number; subscribers: number }
  errors?: string[]
}

export type DestroyAllResult = {
  terminated: string[]
  releasedEips: string[]
  sgDeleted: boolean
  dnsDeleted: boolean
  errors: string[]
}

// ---- AWS clients ----

const ec2 = new EC2Client({ region: REGION, credentials: CREDENTIALS })
const r53 = new Route53Client({ region: "us-east-1", credentials: CREDENTIALS }) // Route53 is global
const ssm = new SSMClient({ region: REGION, credentials: CREDENTIALS })

// ---- EC2 helpers ----

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
    const instance = await describeWsInstance()

    if (!instance?.State?.Name) {
      return NextResponse.json({ status: "offline" } satisfies LiveServerInfo)
    }

    const state = instance.State.Name
    const instanceId = instance.InstanceId
    const eipAllocId = instance.Tags?.find(t => t.Key === "EipAllocationId")?.Value
    const eipPublicIp = instance.Tags?.find(t => t.Key === "EipPublicIp")?.Value

    if (state === "pending") {
      return NextResponse.json({ status: "starting", instanceId, publicIp: eipPublicIp } satisfies LiveServerInfo)
    }
    if (state === "stopping" || state === "shutting-down") {
      return NextResponse.json({ status: "stopping", instanceId } satisfies LiveServerInfo)
    }
    if (state === "stopped") {
      return NextResponse.json({ status: "offline", instanceId } satisfies LiveServerInfo)
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
      } satisfies LiveServerInfo)
    }

    return NextResponse.json({ status: "offline" } satisfies LiveServerInfo)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to describe instance"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ---- POST /api/live-server ----

export async function POST(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { action } = await request.json()

  // ---- START ----
  if (action === "start") {
    // Validate required env vars up front
    const missingVars = [
      ["ROUTE53_HOSTED_ZONE_ID", HOSTED_ZONE_ID],
      ["WS_INTERNAL_SECRET", process.env.WS_INTERNAL_SECRET],
      ["EC2_INSTANCE_PROFILE", process.env.EC2_INSTANCE_PROFILE],
      ["EC2_REPO_URL", REPO_URL],
      ["EC2_GITHUB_TOKEN", GITHUB_TOKEN],
    ].filter(([, v]) => !v).map(([k]) => k)
    if (missingVars.length > 0) {
      return NextResponse.json({ error: `Missing required env vars: ${missingVars.join(", ")}` }, { status: 500 })
    }

    // Track what we've allocated so we can roll back on failure
    const allocated = { eipAllocationId: null as string | null, dnsUpserted: false }

    try {
      const existing = await describeWsInstance()
      if (existing?.State?.Name === "running" || existing?.State?.Name === "pending") {
        return NextResponse.json({ status: "starting", instanceId: existing.InstanceId } satisfies LiveServerInfo)
      }

      const [vpcId, amiId] = await Promise.all([getDefaultVpc(), getLatestUbuntuAmi()])
      const [subnetId, sgId] = await Promise.all([
        getDefaultSubnet(vpcId),
        findOrCreateSecurityGroup(vpcId),
      ])

      // Allocate EIP and tag it independently (findable even without an instance)
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

      // Point DNS at the new IP immediately — propagates while the instance is booting
      await upsertDns(publicIp)
      allocated.dnsUpserted = true

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
cat > .env.local <<'ENVEOF'
${envLines}
ENVEOF
NODE_ENV=production npx tsx server.ts >> /var/log/void-ws.log 2>&1 &`

      const instanceProfile = process.env.EC2_INSTANCE_PROFILE
      if (!instanceProfile) throw new Error("EC2_INSTANCE_PROFILE is not set — create an instance profile and set this env var")

      const runRes = await ec2.send(new RunInstancesCommand({
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

      const instanceId = runRes.Instances?.[0]?.InstanceId

      // Instance is launched — normal stop/destroy-all handles cleanup from here
      allocated.eipAllocationId = null
      allocated.dnsUpserted = false

      return NextResponse.json({ status: "starting", instanceId, publicIp } satisfies LiveServerInfo)
    } catch (err: unknown) {
      // Best-effort rollback of anything we allocated before the failure
      if (allocated.dnsUpserted) { try { await deleteDns() } catch {} }
      if (allocated.eipAllocationId) {
        try { await ec2.send(new ReleaseAddressCommand({ AllocationId: allocated.eipAllocationId })) } catch {}
      }
      const message = err instanceof Error ? err.message : "Failed to start server"
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  // ---- STOP ----
  if (action === "stop") {
    const errors: string[] = []

    let instance: Instance | null
    try {
      instance = await describeWsInstance()
    } catch (e: unknown) {
      return NextResponse.json({ error: `Describe failed: ${e instanceof Error ? e.message : e}` }, { status: 500 })
    }

    if (!instance?.InstanceId) {
      return NextResponse.json({ status: "offline" } satisfies LiveServerInfo)
    }

    const eipAllocId = instance.Tags?.find(t => t.Key === "EipAllocationId")?.Value

    // Step 1: disassociate EIP (best-effort — may not be attached yet)
    // Fetch AssociationId from DescribeAddresses since it's not on the instance object
    if (eipAllocId) {
      try {
        const addrRes = await ec2.send(new DescribeAddressesCommand({
          Filters: [{ Name: "allocation-id", Values: [eipAllocId] }],
        }))
        const assocId = addrRes.Addresses?.[0]?.AssociationId
        if (assocId) {
          await ec2.send(new DisassociateAddressCommand({ AssociationId: assocId }))
        }
      } catch { /* not fatal — may not be associated yet */ }
    }

    // Step 2: release EIP — continue even if this fails
    if (eipAllocId) {
      try {
        await ec2.send(new ReleaseAddressCommand({ AllocationId: eipAllocId }))
      } catch (e: unknown) {
        errors.push(`EIP release failed: ${e instanceof Error ? e.message : e}`)
      }
    }

    // Step 3: terminate instance — always attempt regardless of EIP result
    try {
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instance.InstanceId] }))
    } catch (e: unknown) {
      errors.push(`Terminate failed: ${e instanceof Error ? e.message : e}`)
    }

    // Step 4: remove Route53 record
    try { await deleteDns() }
    catch (e: unknown) { errors.push(`DNS delete failed: ${e instanceof Error ? e.message : e}`) }

    return NextResponse.json({
      status: "stopping",
      instanceId: instance.InstanceId,
      ...(errors.length ? { errors } : {}),
    } satisfies LiveServerInfo)
  }

  // ---- DESTROY ALL ----
  if (action === "destroy-all") {
    const result: DestroyAllResult = {
      terminated: [],
      releasedEips: [],
      sgDeleted: false,
      dnsDeleted: false,
      errors: [],
    }

    // 1. Terminate all instances tagged Purpose=void-ws-server
    try {
      const res = await ec2.send(new DescribeInstancesCommand({
        Filters: [{ Name: "tag:Purpose", Values: [PURPOSE_TAG] }],
      }))
      const instances = res.Reservations?.flatMap(r => r.Instances ?? []) ?? []
      const toTerminate = instances
        .filter(i => i.InstanceId && i.State?.Name !== "terminated" && i.State?.Name !== "shutting-down")
        .map(i => i.InstanceId!)

      if (toTerminate.length > 0) {
        try {
          await ec2.send(new TerminateInstancesCommand({ InstanceIds: toTerminate }))
          result.terminated.push(...toTerminate)
        } catch (e: unknown) {
          result.errors.push(`Terminate instances failed: ${e instanceof Error ? e.message : e}`)
        }
      }
    } catch (e: unknown) {
      result.errors.push(`Describe instances failed: ${e instanceof Error ? e.message : e}`)
    }

    // 2. Release all EIPs tagged Purpose=void-ws-server (covers orphans from failed starts)
    try {
      const res = await ec2.send(new DescribeAddressesCommand({
        Filters: [{ Name: "tag:Purpose", Values: [PURPOSE_TAG] }],
      }))
      const addresses = res.Addresses ?? []

      for (const addr of addresses) {
        // Disassociate first (ignore error — may not be associated)
        if (addr.AssociationId) {
          try { await ec2.send(new DisassociateAddressCommand({ AssociationId: addr.AssociationId })) } catch {}
        }
        // Release
        if (addr.AllocationId) {
          try {
            await ec2.send(new ReleaseAddressCommand({ AllocationId: addr.AllocationId }))
            result.releasedEips.push(addr.AllocationId)
          } catch (e: unknown) {
            result.errors.push(`EIP ${addr.AllocationId} release failed: ${e instanceof Error ? e.message : e}`)
          }
        }
      }
    } catch (e: unknown) {
      result.errors.push(`Describe addresses failed: ${e instanceof Error ? e.message : e}`)
    }

    // 3. Delete security group (may fail if instances are still shutting down — caller can retry)
    try {
      const vpcId = await getDefaultVpc()
      const sgRes = await ec2.send(new DescribeSecurityGroupsCommand({
        Filters: [
          { Name: "group-name", Values: [SG_NAME] },
          { Name: "vpc-id", Values: [vpcId] },
        ],
      }))
      const sgId = sgRes.SecurityGroups?.[0]?.GroupId
      if (sgId) {
        await ec2.send(new DeleteSecurityGroupCommand({ GroupId: sgId }))
        result.sgDeleted = true
      }
    } catch (e: unknown) {
      result.errors.push(`SG delete failed: ${e instanceof Error ? e.message : e}`)
    }

    // 4. Delete Route53 record
    try {
      await deleteDns()
      result.dnsDeleted = true
    } catch (e: unknown) {
      result.errors.push(`DNS delete failed: ${e instanceof Error ? e.message : e}`)
    }

    return NextResponse.json(result)
  }

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
