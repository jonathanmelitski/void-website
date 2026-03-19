import { randomUUID } from "crypto"
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"
import { getEvent, deleteEvent } from "./dynamo"
import {
  getNewsletter,
  deleteNewsletter,
  setNewsletterPublished,
  appendNewsletterEntry,
  removeNewsletterEntry,
  type NewsletterEntry,
} from "./newsletters"

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "PUBLISH"
  | "UNPUBLISH"
  | "ENTRY_ADD"
  | "ENTRY_REMOVE"

export type AuditEntityType = "EVENT" | "NEWSLETTER" | "NEWSLETTER_ENTRY" | "PHOTO"

export type AuditLogEntry = {
  id: string
  timestamp: string
  actorUsername: string
  action: AuditAction
  entityType: AuditEntityType
  entityId: string
  entityLabel: string
  previousState?: Record<string, unknown>
  newState?: Record<string, unknown>
  reversible: boolean
  revertedBy?: string
  revertedAt?: string
}

const AUDIT_TABLE = () => process.env.DYNAMO_AUDIT_TABLE!

export async function logAudit(params: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void> {
  const entry: AuditLogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...params,
  }
  await dynamo.send(new PutCommand({ TableName: AUDIT_TABLE(), Item: entry }))
}

export async function listAuditLogs(limit = 100): Promise<AuditLogEntry[]> {
  const result = await dynamo.send(new ScanCommand({ TableName: AUDIT_TABLE() }))
  const items = (result.Items ?? []) as AuditLogEntry[]
  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}

export async function getAuditLog(id: string): Promise<AuditLogEntry | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: AUDIT_TABLE(), Key: { id } })
  )
  return (result.Item as AuditLogEntry) ?? null
}

export async function checkRevertConflicts(
  entry: AuditLogEntry
): Promise<{ warnings: string[]; blocking: boolean }> {
  const warnings: string[] = []
  let blocking = false

  if (entry.action === "CREATE") {
    if (entry.entityType === "EVENT") {
      const existing = await getEvent(entry.entityId)
      if (!existing) {
        warnings.push("Entity was already deleted; nothing to revert.")
        blocking = true
      }
    } else if (entry.entityType === "NEWSLETTER") {
      const existing = await getNewsletter(entry.entityId)
      if (!existing) {
        warnings.push("Entity was already deleted; nothing to revert.")
        blocking = true
      }
    }
  }

  if (entry.action === "DELETE") {
    if (entry.entityType === "EVENT") {
      const existing = await getEvent(entry.entityId)
      if (existing) {
        warnings.push("Entity already exists; likely re-created after this deletion.")
        blocking = true
      }
    } else if (entry.entityType === "NEWSLETTER") {
      const existing = await getNewsletter(entry.entityId)
      if (existing) {
        warnings.push("Entity already exists; likely re-created after this deletion.")
        blocking = true
      }
    }
  }

  if (entry.action === "ENTRY_ADD") {
    const newsletter = await getNewsletter(entry.entityId)
    const entryId = entry.newState?.entryId as string | undefined
    if (entryId && newsletter) {
      const stillPresent = (newsletter.entries ?? []).some(e => e.id === entryId)
      if (!stillPresent) {
        warnings.push("Entry was already removed.")
        blocking = true
      }
    }
  }

  // Non-blocking: warn if there are newer unreverted changes to the same entity
  const allLogs = await dynamo.send(new ScanCommand({ TableName: AUDIT_TABLE() }))
  const newerChanges = ((allLogs.Items ?? []) as AuditLogEntry[]).filter(
    l =>
      l.entityId === entry.entityId &&
      l.id !== entry.id &&
      new Date(l.timestamp).getTime() > new Date(entry.timestamp).getTime() &&
      !l.revertedBy
  )
  if (newerChanges.length > 0) {
    warnings.push(
      `There are ${newerChanges.length} newer unreverted change(s) to this ${entry.entityType}. Reverting this entry may make those changes inconsistent.`
    )
  }

  return { warnings, blocking }
}

export async function revertAuditLog(
  entry: AuditLogEntry,
  actorUsername: string
): Promise<void> {
  switch (entry.action) {
    case "CREATE": {
      if (entry.entityType === "EVENT") {
        await deleteEvent(entry.entityId)
      } else if (entry.entityType === "NEWSLETTER") {
        await deleteNewsletter(entry.entityId)
      }
      break
    }
    case "DELETE": {
      if (entry.previousState) {
        if (entry.entityType === "EVENT") {
          await dynamo.send(
            new PutCommand({
              TableName: process.env.DYNAMO_EVENTS_TABLE!,
              Item: entry.previousState,
            })
          )
        } else if (entry.entityType === "NEWSLETTER") {
          await dynamo.send(
            new PutCommand({
              TableName: process.env.DYNAMO_NEWSLETTERS_TABLE!,
              Item: entry.previousState,
            })
          )
        }
      }
      break
    }
    case "UPDATE": {
      if (entry.previousState) {
        if (entry.entityType === "EVENT") {
          await dynamo.send(
            new PutCommand({
              TableName: process.env.DYNAMO_EVENTS_TABLE!,
              Item: entry.previousState,
            })
          )
        } else if (entry.entityType === "NEWSLETTER") {
          await dynamo.send(
            new PutCommand({
              TableName: process.env.DYNAMO_NEWSLETTERS_TABLE!,
              Item: entry.previousState,
            })
          )
        }
      }
      break
    }
    case "PUBLISH": {
      await setNewsletterPublished(entry.entityId, false)
      break
    }
    case "UNPUBLISH": {
      await setNewsletterPublished(entry.entityId, true)
      break
    }
    case "ENTRY_ADD": {
      const entryId = entry.newState?.entryId as string | undefined
      if (entryId) {
        await removeNewsletterEntry(entry.entityId, entryId)
      }
      break
    }
    case "ENTRY_REMOVE": {
      if (entry.previousState?.entry) {
        await appendNewsletterEntry(entry.entityId, entry.previousState.entry as NewsletterEntry)
      }
      break
    }
  }

  // Mark as reverted
  await dynamo.send(
    new UpdateCommand({
      TableName: AUDIT_TABLE(),
      Key: { id: entry.id },
      UpdateExpression: "SET revertedBy = :by, revertedAt = :at",
      ExpressionAttributeValues: {
        ":by": actorUsername,
        ":at": new Date().toISOString(),
      },
    })
  )

  // Log the inverse action
  const inverseAction: AuditAction =
    entry.action === "CREATE"
      ? "DELETE"
      : entry.action === "DELETE"
      ? "CREATE"
      : entry.action === "PUBLISH"
      ? "UNPUBLISH"
      : entry.action === "UNPUBLISH"
      ? "PUBLISH"
      : entry.action === "ENTRY_ADD"
      ? "ENTRY_REMOVE"
      : entry.action === "ENTRY_REMOVE"
      ? "ENTRY_ADD"
      : entry.action

  void logAudit({
    actorUsername,
    action: inverseAction,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    reversible: false,
  })
}
