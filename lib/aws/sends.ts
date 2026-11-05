import { randomUUID } from "crypto"
import { DeleteCommand, GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import type { SendStatus } from "@/lib/bulk-send"

const TABLE = () => process.env.DYNAMO_SENDS_TABLE!

export type SendRecord = {
  id: string
  newsletterId: string
  newsletterTitle: string
  listName: string
  sendMode?: "list" | "test" | "dryrun"
  sentAt: string
  sentBy: string
  recipientCount: number
  failedCount?: number
  failedRecipients?: string[]
  trackingEnabled?: boolean
  trackedLinks?: string[]
  // Progress tracking (list sends from 2026-11 on; older records have none of these).
  // 627 addresses ≈ 20 KB, far under DynamoDB's 400 KB item limit (room for ~10k recipients).
  status?: SendStatus
  updatedAt?: string
  /** Owner of the current run. Progress writes are conditional on it, so two runs can't interleave. */
  runId?: string
  totalRecipients?: number
  sentRecipients?: string[]
  /** Batch being sent right now. If a run dies mid-batch these become `unknownRecipients`. */
  inFlight?: string[]
  /** May or may not have received the email; never re-sent automatically. */
  unknownRecipients?: string[]
  /** Options of the original send, so a resumed run sends the same email. */
  sendOpts?: { subject?: string; replyTo?: string; fromName?: string; includeWebLink?: boolean }
  /** "inline" = sent from the API request (stopgap); "worker" = email-worker Lambda job. */
  engine?: "inline" | "worker"
  /** Set by Cancel; both engines stop before their next batch. */
  cancelRequested?: boolean
  /** Worker jobs: rows stuck in SENDING (may or may not have received it; never re-sent). */
  unknownCount?: number
  /** Plain-language reason the last run stopped. */
  lastError?: string
  startedAt?: string
  finishedAt?: string
  /** Worker dry run: walks the list and records who would get it; never calls SES SendEmail. */
  dryRun?: boolean
  /** Worker: the recipient rows have been written to SendRecipients. */
  recipientsLoaded?: boolean
}

export async function logSend(
  params: Omit<SendRecord, "id">,
  id?: string
): Promise<SendRecord> {
  const record: SendRecord = {
    id: id ?? randomUUID(),
    ...params,
  }
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: record }))
  return record
}

export async function updateSend(id: string, fields: Partial<Omit<SendRecord, "id">>): Promise<void> {
  const existing = await getSend(id)
  if (!existing) return
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: { ...existing, ...fields } }))
}

export async function getSend(id: string): Promise<SendRecord | null> {
  const result = await dynamo.send(new GetCommand({ TableName: TABLE(), Key: { id } }))
  return (result.Item as SendRecord) ?? null
}

export async function deleteSend(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}

export async function listSends(limit = 100): Promise<SendRecord[]> {
  // Paginate: records now carry recipient lists, so the table can pass one 1 MB Scan page.
  const items: SendRecord[] = []
  let startKey: Record<string, unknown> | undefined
  do {
    const result = await dynamo.send(new ScanCommand({ TableName: TABLE(), ExclusiveStartKey: startKey }))
    items.push(...((result.Items ?? []) as SendRecord[]))
    startKey = result.LastEvaluatedKey
  } while (startKey)
  return items
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
    .slice(0, limit)
}

export type SendSummary = Omit<SendRecord, "sentRecipients" | "failedRecipients" | "unknownRecipients" | "inFlight" | "trackedLinks" | "runId"> & {
  unknownCount: number
  failedRecipientCount: number
  /** Inline sends: the record lists who was sent (so it can be resumed). */
  tracksRecipients: boolean
}

/** The record without its recipient lists, for polling. */
export function summarizeSend(s: SendRecord): SendSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sentRecipients, failedRecipients, unknownRecipients, inFlight, trackedLinks, runId, ...rest } = s
  return {
    ...rest,
    unknownCount: s.unknownCount ?? (unknownRecipients?.length ?? 0) + (inFlight?.length ?? 0),
    failedRecipientCount: failedRecipients?.length ?? 0,
    tracksRecipients: Array.isArray(sentRecipients),
  }
}

// ── Progress writes for list sends ──────────────────────────────────────────────
// All are conditional on runId, so a run that lost ownership (a resume took over) fails its next
// write and stops instead of interleaving. Lists are appended atomically; nothing is read-modify-written.

const nowIso = () => new Date().toISOString()

/** After the recipient list is loaded: record the total (first run only) and the tracked links. */
export async function markSendStarted(
  id: string,
  runId: string,
  fields: { totalRecipients?: number; trackedLinks?: string[] }
): Promise<void> {
  const sets = ["updatedAt = :now", "#status = :sending"]
  const values: Record<string, unknown> = { ":now": nowIso(), ":sending": "sending", ":run": runId }
  if (fields.totalRecipients !== undefined) {
    sets.push("totalRecipients = :total")
    values[":total"] = fields.totalRecipients
  }
  if (fields.trackedLinks) {
    sets.push("trackedLinks = :links")
    values[":links"] = fields.trackedLinks
  }
  await dynamo.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { id },
    UpdateExpression: `SET ${sets.join(", ")}`,
    ConditionExpression: "runId = :run",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: values,
  }))
}

/** Written before a batch goes out, so a run killed mid-batch leaves those addresses as "unknown". */
export async function markBatchInFlight(id: string, runId: string, emails: string[]): Promise<void> {
  await dynamo.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { id },
    UpdateExpression: "SET inFlight = :emails, updatedAt = :now",
    // Fails once Cancel was pressed, so the run stops before sending another batch.
    ConditionExpression: "runId = :run AND attribute_not_exists(cancelRequested)",
    ExpressionAttributeValues: { ":emails": emails, ":now": nowIso(), ":run": runId },
  }))
}

export async function recordBatchResult(id: string, runId: string, sent: string[], failed: string[]): Promise<void> {
  await dynamo.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { id },
    UpdateExpression:
      "SET sentRecipients = list_append(if_not_exists(sentRecipients, :empty), :sent), " +
      "failedRecipients = list_append(if_not_exists(failedRecipients, :empty), :failed), updatedAt = :now " +
      "ADD recipientCount :ns, failedCount :nf REMOVE inFlight",
    ConditionExpression: "runId = :run",
    ExpressionAttributeValues: {
      ":empty": [], ":sent": sent, ":failed": failed, ":ns": sent.length, ":nf": failed.length,
      ":now": nowIso(), ":run": runId,
    },
  }))
}

export async function finishSendRun(id: string, runId: string, status: SendStatus, lastError?: string): Promise<void> {
  const t = nowIso()
  await dynamo.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { id },
    UpdateExpression: lastError
      ? "SET #status = :status, updatedAt = :now, finishedAt = :now, lastError = :err"
      : "SET #status = :status, updatedAt = :now, finishedAt = :now",
    ConditionExpression: "runId = :run",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: lastError
      ? { ":status": status, ":now": t, ":run": runId, ":err": lastError }
      : { ":status": status, ":now": t, ":run": runId },
  }))
}

/**
 * Takes over a stopped send for a resumed run. Optimistic lock on updatedAt: throws
 * ConditionalCheckFailedException if the old run wrote anything since `seen` was read. A batch the
 * old run left in flight moves to unknownRecipients, so it is never re-sent.
 */
export async function claimSendRun(
  seen: SendRecord,
  runId: string,
  status: "sending" | "queued" = "sending"
): Promise<void> {
  const unknown = [...(seen.unknownRecipients ?? []), ...(seen.inFlight ?? [])]
  await dynamo.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { id: seen.id },
    UpdateExpression:
      "SET runId = :run, #status = :status, updatedAt = :now, unknownRecipients = :unknown " +
      "REMOVE inFlight, cancelRequested, lastError",
    ConditionExpression: "updatedAt = :seen AND #status <> :complete",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":run": runId, ":status": status, ":now": nowIso(), ":unknown": unknown,
      ":seen": seen.updatedAt ?? "", ":complete": "complete",
    },
  }))
}

/**
 * Cancel: flags the record; the running engine stops before its next batch. A queued job (or one whose
 * run is already dead) is marked cancelled straight away.
 */
export async function requestCancel(id: string, markCancelledNow: boolean): Promise<void> {
  await dynamo.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { id },
    UpdateExpression: markCancelledNow
      ? "SET cancelRequested = :t, #status = :cancelled, updatedAt = :now, finishedAt = :now"
      : "SET cancelRequested = :t",
    ConditionExpression: "attribute_exists(id) AND #status <> :complete",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: markCancelledNow
      ? { ":t": true, ":cancelled": "cancelled", ":now": nowIso(), ":complete": "complete" }
      : { ":t": true, ":complete": "complete" },
  }))
}
