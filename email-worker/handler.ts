// void-email-worker Lambda. Invoked asynchronously by POST /api/marketing/send (and by itself, to hand
// off before the 15-minute limit). Uses the Lambda execution role (no access keys). See README.md.

import { randomUUID } from "crypto"
import { SESv2Client, GetAccountCommand, GetContactListCommand, ListContactsCommand, SendEmailCommand } from "@aws-sdk/client-sesv2"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { runWorker, type Job, type JobPatch, type RecipientStatus, type WorkerDeps, type WorkerEvent } from "./core"
import { emailBaseUrlProblem, listAllPaced, realSleep, withThrottleRetry } from "../lib/bulk-send"
import { buildNewsletterHtml, injectTracking } from "../lib/newsletter-html"
import { newsletterTextBody } from "../lib/newsletter-text-compat"
import type { NewsletterItem } from "../lib/aws/newsletters"

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is not set`)
  return v
}

const ses = new SESv2Client({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })
const lambda = new LambdaClient({})

const SENDS = () => env("DYNAMO_SENDS_TABLE")
const RECIPIENTS = () => env("DYNAMO_SEND_RECIPIENTS_TABLE")
const CONTACT_LIST = () => process.env.SES_CONTACT_LIST_NAME ?? "void-ultimate"

type LambdaContext = { getRemainingTimeInMillis(): number; functionName: string }

type SendJob = Job & {
  newsletterId: string
  trackingEnabled?: boolean
  sendOpts?: { subject?: string; replyTo?: string; fromName?: string; includeWebLink?: boolean }
}

function buildUpdate(patch: JobPatch) {
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  const sets: string[] = []
  const adds: string[] = []
  let i = 0
  for (const [k, v] of Object.entries(patch.set ?? {})) {
    names[`#f${i}`] = k
    values[`:v${i}`] = v
    sets.push(`#f${i} = :v${i}`)
    i++
  }
  for (const [k, v] of Object.entries(patch.add ?? {})) {
    names[`#f${i}`] = k
    values[`:v${i}`] = v
    adds.push(`#f${i} :v${i}`)
    i++
  }
  const expr = [sets.length ? `SET ${sets.join(", ")}` : "", adds.length ? `ADD ${adds.join(", ")}` : ""].filter(Boolean).join(" ")
  return { expr, names, values }
}

async function listContacts(listName: string): Promise<string[]> {
  const res = await withThrottleRetry(() => ses.send(new GetContactListCommand({ ContactListName: CONTACT_LIST() })))
  if (!(res.Topics ?? []).some(t => t.TopicName === listName)) throw new Error(`Topic not found: ${listName}`)
  await realSleep(1100) // contact-list APIs: ~1 request/s
  return listAllPaced(async nextToken => {
    const page = await ses.send(new ListContactsCommand({
      ContactListName: CONTACT_LIST(),
      Filter: { FilteredStatus: "OPT_IN", TopicFilter: { TopicName: listName, UseDefaultIfPreferenceUnavailable: false } },
      NextToken: nextToken,
    }))
    return { items: (page.Contacts ?? []).map(c => c.EmailAddress!).filter(Boolean), nextToken: page.NextToken }
  })
}

function dynamoDeps(context: LambdaContext): Omit<WorkerDeps, "getJob" | "updateJob" | "sendEmail" | "audit"> {
  return {
    now: () => Date.now(),
    sleep: realSleep,
    remainingMs: () => context.getRemainingTimeInMillis(),
    listContacts,
    async putRecipientIfAbsent(sendId, email) {
      try {
        await ddb.send(new PutCommand({
          TableName: RECIPIENTS(),
          Item: { sendId, email, status: "PENDING", createdAt: new Date().toISOString() },
          ConditionExpression: "attribute_not_exists(sendId)",
        }))
        return true
      } catch (err) {
        if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false
        throw err
      }
    },
    async queryRecipients(sendId, status, limit) {
      // Pages until `limit` matches are found (the filter applies after each page is read).
      const out: string[] = []
      let startKey: Record<string, unknown> | undefined
      do {
        const res = await ddb.send(new QueryCommand({
          TableName: RECIPIENTS(),
          KeyConditionExpression: "sendId = :id",
          FilterExpression: "#s = :s",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":id": sendId, ":s": status },
          ExclusiveStartKey: startKey,
        }))
        for (const it of res.Items ?? []) {
          out.push(it.email as string)
          if (out.length >= limit) return out
        }
        startKey = res.LastEvaluatedKey
      } while (startKey)
      return out
    },
    async countRecipients(sendId, status) {
      let n = 0
      let startKey: Record<string, unknown> | undefined
      do {
        const res = await ddb.send(new QueryCommand({
          TableName: RECIPIENTS(),
          KeyConditionExpression: "sendId = :id",
          FilterExpression: "#s = :s",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":id": sendId, ":s": status },
          Select: "COUNT",
          ExclusiveStartKey: startKey,
        }))
        n += res.Count ?? 0
        startKey = res.LastEvaluatedKey
      } while (startKey)
      return n
    },
    async transition(sendId, email, from: RecipientStatus, to: RecipientStatus, extra = {}) {
      const { expr, names, values } = buildUpdate({ set: { ...extra, updatedAt: new Date().toISOString() } })
      try {
        await ddb.send(new UpdateCommand({
          TableName: RECIPIENTS(),
          Key: { sendId, email },
          UpdateExpression: `${expr}, #st = :to`,
          ConditionExpression: "#st = :from",
          ExpressionAttributeNames: { ...names, "#st": "status" },
          ExpressionAttributeValues: { ...values, ":to": to, ":from": from },
        }))
        return true
      } catch (err) {
        if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false
        throw err
      }
    },
    async maxSendRate() {
      try {
        const acct = await ses.send(new GetAccountCommand({}))
        return acct.SendQuota?.MaxSendRate ?? 1
      } catch {
        return 1
      }
    },
    async reinvoke(event) {
      await lambda.send(new InvokeCommand({
        FunctionName: context.functionName,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(event)),
      }))
    },
    log: (event, data) => console.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() })),
  }
}

/** Real send: the record lives in the sends table; email goes out through SES. */
async function realDeps(event: WorkerEvent, context: LambdaContext): Promise<WorkerDeps> {
  const getJob = async (id: string) =>
    ((await ddb.send(new GetCommand({ TableName: SENDS(), Key: { id }, ConsistentRead: true }))).Item as SendJob) ?? null

  const job = await getJob(event.sendId)
  const base = dynamoDeps(context)
  const deps: WorkerDeps = {
    ...base,
    getJob,
    async updateJob(id, runId, patch) {
      const { expr, names, values } = buildUpdate(patch)
      await ddb.send(new UpdateCommand({
        TableName: SENDS(),
        Key: { id },
        UpdateExpression: expr,
        ConditionExpression: "#run = :run",
        ExpressionAttributeNames: { ...names, "#run": "runId" },
        ExpressionAttributeValues: { ...values, ":run": runId },
      }))
    },
    async audit({ sendId, label, state }) {
      await ddb.send(new PutCommand({
        TableName: env("DYNAMO_AUDIT_TABLE"),
        Item: {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          actorUsername: job?.sentBy ?? "email-worker",
          action: "SEND",
          entityType: "SEND",
          entityId: sendId,
          entityLabel: label,
          newState: { ...state, engine: "worker" },
          reversible: false,
        },
      }))
    },
  }

  // Dry runs never get a sender: there is no code path from a dry run to SendEmail.
  if (event.dryRun !== true && job && job.dryRun !== true) {
    const newsletter = (await ddb.send(new GetCommand({
      TableName: env("DYNAMO_NEWSLETTERS_TABLE"), Key: { id: job.newsletterId },
    }))).Item as NewsletterItem | undefined
    if (!newsletter) throw new Error("Newsletter not found")
    const baseUrlProblem = emailBaseUrlProblem() // EMAIL-10: links must point at the public site
    if (baseUrlProblem) throw new Error(baseUrlProblem)
    const opts = job.sendOpts ?? {}
    const baseHtml = buildNewsletterHtml(newsletter, "light", true, opts.includeWebLink)
    const textBody = newsletterTextBody(newsletter, opts.includeWebLink)
    const from = opts.fromName ? `"${opts.fromName}" <${env("SES_FROM_EMAIL")}>` : env("SES_FROM_EMAIL")
    const subject = opts.subject || newsletter.title
    deps.sendEmail = async email => {
      const html = job.trackingEnabled ? injectTracking(baseHtml, randomUUID(), job.id).html : baseHtml
      const res = await ses.send(new SendEmailCommand({
        FromEmailAddress: from,
        ReplyToAddresses: opts.replyTo ? [opts.replyTo] : undefined,
        Destination: { ToAddresses: [email] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html }, ...textBody } } },
        ListManagementOptions: { ContactListName: CONTACT_LIST(), TopicName: job.listName },
      }))
      return { messageId: res.MessageId }
    }
  }
  return deps
}

/** Setup check: dry run with in-memory job state. Writes only SendRecipients rows under a dryrun-* id. */
function ephemeralDeps(event: WorkerEvent, context: LambdaContext): WorkerDeps {
  const job: Job = {
    id: event.sendId, runId: event.runId, status: "queued", listName: event.ephemeral!.listName,
    newsletterTitle: "(setup dry run)", sentBy: "email-worker", dryRun: true, recipientCount: 0, failedCount: 0,
  }
  const base = dynamoDeps(context)
  return {
    ...base,
    getJob: async () => ({ ...job }),
    async updateJob(_id, runId, patch) {
      if (runId !== job.runId) throw Object.assign(new Error("superseded"), { name: "ConditionalCheckFailedException" })
      Object.assign(job, patch.set ?? {})
      for (const [k, v] of Object.entries(patch.add ?? {})) {
        const rec = job as unknown as Record<string, number>
        rec[k] = (rec[k] ?? 0) + v
      }
    },
    audit: async ({ state }) => console.log(JSON.stringify({ event: "dryrun_summary", ...state })),
    reinvoke: async () => { throw new Error("ephemeral dry run can't hand off") },
  }
}

export const handler = async (event: WorkerEvent, context: LambdaContext) => {
  console.log(JSON.stringify({ event: "invoke", sendId: event.sendId, dryRun: event.dryRun === true, ephemeral: !!event.ephemeral }))
  if (!event?.sendId || !event.runId) throw new Error("sendId and runId are required")

  if (event.ephemeral) {
    if (event.dryRun !== true || !event.sendId.startsWith("dryrun-")) {
      throw new Error("ephemeral runs must be dry runs with a dryrun-* id")
    }
    return runWorker(event, ephemeralDeps(event, context))
  }
  let deps: WorkerDeps
  try {
    deps = await realDeps(event, context)
  } catch (err) {
    // Setup problem (newsletter gone, bad base URL…): fail the job visibly instead of leaving it queued.
    const message = err instanceof Error ? err.message : String(err)
    console.error(JSON.stringify({ event: "setup_failed", sendId: event.sendId, error: message }))
    await ddb.send(new UpdateCommand({
      TableName: SENDS(),
      Key: { id: event.sendId },
      UpdateExpression: "SET #s = :failed, lastError = :err, updatedAt = :now, finishedAt = :now",
      ConditionExpression: "runId = :run",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":failed": "failed", ":run": event.runId, ":now": new Date().toISOString(),
        ":err": message.startsWith("Email links") ? message : "The email worker couldn't prepare this send. Nothing was sent.",
      },
    })).catch(() => {})
    return { outcome: "failed" as const, sent: 0, failed: 0 }
  }
  const out = await runWorker(event, deps)
  console.log(JSON.stringify({ event: "done", sendId: event.sendId, ...out }))
  return out
}
