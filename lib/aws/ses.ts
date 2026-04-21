import {
  SESv2Client,
  GetContactListCommand,
  CreateContactListCommand,
  UpdateContactListCommand,
  ListContactsCommand,
  CreateContactCommand,
  UpdateContactCommand,
  SendEmailCommand,
  CreateImportJobCommand,
  GetImportJobCommand,
  type Topic,
} from "@aws-sdk/client-sesv2"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { s3 } from "@/lib/aws/s3"
import { randomUUID } from "crypto"
import { buildNewsletterHtml, injectTracking } from "@/lib/newsletter-html"
import type { NewsletterItem } from "@/lib/aws/newsletters"

const client = new SESv2Client({
  region: process.env.VOID_REGION!,
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

// All "lists" are implemented as topics on this single SES contact list.
// Set SES_CONTACT_LIST_NAME to your existing contact list name.
const CONTACT_LIST = process.env.SES_CONTACT_LIST_NAME ?? "void-ultimate"

async function getTopics(): Promise<Topic[]> {
  try {
    const res = await client.send(new GetContactListCommand({ ContactListName: CONTACT_LIST }))
    return res.Topics ?? []
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NotFoundException") return []
    throw err
  }
}

// ── List management (topics) ──────────────────────────────────────────────────

export async function listContactLists(): Promise<{ name: string }[]> {
  const topics = await getTopics()
  return topics.map(t => ({ name: t.TopicName! }))
}

export async function createContactList(name: string, _description?: string): Promise<void> {
  let topics: Topic[] = []
  let listExists = true
  try {
    const res = await client.send(new GetContactListCommand({ ContactListName: CONTACT_LIST }))
    topics = res.Topics ?? []
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NotFoundException") {
      listExists = false
    } else {
      throw err
    }
  }

  const newTopic: Topic = {
    TopicName: name,
    DisplayName: name,
    DefaultSubscriptionStatus: "OPT_OUT",
  }

  if (!listExists) {
    await client.send(new CreateContactListCommand({
      ContactListName: CONTACT_LIST,
      Topics: [newTopic],
    }))
  } else {
    await client.send(new UpdateContactListCommand({
      ContactListName: CONTACT_LIST,
      Topics: [...topics, newTopic],
    }))
  }
}

export async function deleteContactList(name: string): Promise<void> {
  const topics = await getTopics()
  await client.send(new UpdateContactListCommand({
    ContactListName: CONTACT_LIST,
    Topics: topics.filter(t => t.TopicName !== name),
  }))
}

// ── Contact management (per-topic) ───────────────────────────────────────────

export async function listContacts(
  topicName: string
): Promise<{ email: string; unsubscribed: boolean }[]> {
  // Verify the topic exists so callers get a proper error (e.g. subscribe → 404)
  const topics = await getTopics()
  if (!topics.some(t => t.TopicName === topicName)) {
    throw new Error(`Topic not found: ${topicName}`)
  }

  const results: { email: string; unsubscribed: boolean }[] = []

  let nextToken: string | undefined
  do {
    const res = await client.send(
      new ListContactsCommand({
        ContactListName: CONTACT_LIST,
        Filter: {
          FilteredStatus: "OPT_IN",
          TopicFilter: { TopicName: topicName, UseDefaultIfPreferenceUnavailable: false },
        },
        NextToken: nextToken,
      })
    )
    for (const c of res.Contacts ?? []) {
      results.push({ email: c.EmailAddress!, unsubscribed: false })
    }
    nextToken = res.NextToken
  } while (nextToken)

  return results
}

export async function createContact(topicName: string, email: string): Promise<void> {
  try {
    await client.send(
      new CreateContactCommand({
        ContactListName: CONTACT_LIST,
        EmailAddress: email,
        TopicPreferences: [{ TopicName: topicName, SubscriptionStatus: "OPT_IN" }],
      })
    )
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "AlreadyExistsException") {
      await client.send(
        new UpdateContactCommand({
          ContactListName: CONTACT_LIST,
          EmailAddress: email,
          TopicPreferences: [{ TopicName: topicName, SubscriptionStatus: "OPT_IN" }],
        })
      )
    } else {
      throw err
    }
  }
}

export type BulkContactResult = {
  added: string[]
  failed: { email: string; reason: string }[]
  processedCount: number
}

export async function createContacts(
  topicName: string,
  emails: string[]
): Promise<BulkContactResult> {
  const bucket = process.env.S3_BUCKET_NAME!
  const key = `ses-imports/${randomUUID()}.csv`

  // SES import CSV supports topic preferences via a column named topicPreferences.TOPIC_NAME
  const csv = [`emailAddress,topicPreferences.${topicName}`, ...emails.map(e => `${e},OPT_IN`)].join("\n")

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: csv,
    ContentType: "text/csv",
  }))

  const job = await client.send(new CreateImportJobCommand({
    ImportDestination: {
      ContactListDestination: {
        ContactListName: CONTACT_LIST,
        ContactListImportAction: "PUT",
      },
    },
    ImportDataSource: {
      S3Url: `s3://${bucket}/${key}`,
      DataFormat: "CSV",
    },
  }))

  const jobId = job.JobId!

  // Poll until complete (max 60s)
  let finalStatus = null
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const status = await client.send(new GetImportJobCommand({ JobId: jobId }))
    if (status.JobStatus === "COMPLETED" || status.JobStatus === "FAILED") {
      finalStatus = status
      break
    }
  }

  if (!finalStatus) {
    return {
      added: [],
      failed: emails.map(email => ({ email, reason: "Import job timed out (still running)" })),
      processedCount: emails.length,
    }
  }

  if (finalStatus.JobStatus === "FAILED") {
    const reason = finalStatus.FailureInfo?.ErrorMessage ?? "Import job failed"
    console.error("[ses] bulk import job failed:", finalStatus.FailureInfo)
    return {
      added: [],
      failed: emails.map(email => ({ email, reason })),
      processedCount: emails.length,
    }
  }

  // Job completed — parse the failure report if any records failed
  const failed: { email: string; reason: string }[] = []

  if (finalStatus.FailureInfo?.FailedRecordsS3Url) {
    try {
      const res = await fetch(finalStatus.FailureInfo.FailedRecordsS3Url)
      const text = await res.text()
      // Format: header row, then one row per failed contact: emailAddress,reason
      const lines = text.trim().split("\n").slice(1)
      for (const line of lines) {
        const comma = line.indexOf(",")
        if (comma === -1) continue
        const email = line.slice(0, comma).trim().replace(/^"|"$/g, "")
        const reason = line.slice(comma + 1).trim().replace(/^"|"$/g, "") || "Rejected by SES"
        if (email) failed.push({ email, reason })
      }
    } catch (err) {
      console.error("[ses] failed to read bulk import failure report:", err)
    }
  }

  const failedSet = new Set(failed.map(f => f.email.toLowerCase()))
  const added = emails.filter(e => !failedSet.has(e.toLowerCase()))

  return { added, failed, processedCount: emails.length }
}

// OPT_OUT from the topic rather than deleting the contact globally
// (the contact may be subscribed to other topics)
export async function deleteContact(topicName: string, email: string): Promise<void> {
  await client.send(
    new UpdateContactCommand({
      ContactListName: CONTACT_LIST,
      EmailAddress: email,
      TopicPreferences: [{ TopicName: topicName, SubscriptionStatus: "OPT_OUT" }],
    })
  )
}

// ── Email sending ─────────────────────────────────────────────────────────────

type SendOpts = {
  subject?: string
  replyTo?: string
  fromName?: string
  includeWebLink?: boolean
  trackingEnabled?: boolean
}

function buildFrom(name?: string): string {
  const email = process.env.SES_FROM_EMAIL!
  return name ? `"${name}" <${email}>` : email
}

type SendCallbacks = {
  onStart?: (total: number) => void
  onResult?: (email: string, status: "sent" | "failed") => void
}

export async function sendNewsletterToList(
  _newsletterId: string,
  newsletter: NewsletterItem,
  listName: string,
  opts: SendOpts = {},
  sendId?: string,
  callbacks?: SendCallbacks
): Promise<{ sent: number; failed: number; failedRecipients: string[]; trackedLinks: string[] }> {
  const contacts = await listContacts(listName)
  const active = contacts.filter(c => !c.unsubscribed)
  const baseHtml = buildNewsletterHtml(newsletter, "light", true, opts.includeWebLink)
  const subject = opts.subject || newsletter.title
  const replyTo = opts.replyTo ? [opts.replyTo] : undefined
  const from = buildFrom(opts.fromName)

  let trackedLinks: string[] = []
  if (opts.trackingEnabled && sendId && active.length > 0) {
    trackedLinks = injectTracking(baseHtml, "probe", sendId).links
  }

  console.log(JSON.stringify({ event: "send_start", sendId, listName, total: active.length, ts: new Date().toISOString() }))
  callbacks?.onStart?.(active.length)

  let sent = 0
  const failedRecipients: string[] = []

  const BATCH = 10
  const BATCH_DELAY_MS = 1000
  for (let i = 0; i < active.length; i += BATCH) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    const batch = active.slice(i, i + BATCH)
    await Promise.allSettled(
      batch.map(async contact => {
        let html = baseHtml
        if (opts.trackingEnabled && sendId) {
          html = injectTracking(baseHtml, randomUUID(), sendId).html
        }
        try {
          await client.send(
            new SendEmailCommand({
              FromEmailAddress: from,
              ReplyToAddresses: replyTo,
              Destination: { ToAddresses: [contact.email] },
              Content: {
                Simple: {
                  Subject: { Data: subject },
                  Body: { Html: { Data: html } },
                },
              },
              ListManagementOptions: { ContactListName: CONTACT_LIST, TopicName: listName },
            })
          )
          sent++
          console.log(JSON.stringify({ event: "email_sent", sendId, email: contact.email, status: "sent", ts: new Date().toISOString() }))
          callbacks?.onResult?.(contact.email, "sent")
        } catch (err) {
          console.error(JSON.stringify({ event: "email_sent", sendId, email: contact.email, status: "failed", error: err instanceof Error ? err.message : String(err), ts: new Date().toISOString() }))
          failedRecipients.push(contact.email)
          callbacks?.onResult?.(contact.email, "failed")
        }
      })
    )
  }

  console.log(JSON.stringify({ event: "send_complete", sendId, sent, failed: failedRecipients.length, ts: new Date().toISOString() }))
  return { sent, failed: failedRecipients.length, failedRecipients, trackedLinks }
}

export async function sendToEmails(
  emails: string[],
  newsletter: NewsletterItem,
  listName: string,
  opts: SendOpts = {},
  sendId?: string,
  callbacks?: SendCallbacks
): Promise<{ sent: number; failed: number; failedRecipients: string[]; trackedLinks: string[] }> {
  const baseHtml = buildNewsletterHtml(newsletter, "light", true, opts.includeWebLink)
  const subject = opts.subject || newsletter.title
  const replyTo = opts.replyTo ? [opts.replyTo] : undefined
  const from = buildFrom(opts.fromName)

  let trackedLinks: string[] = []
  if (opts.trackingEnabled && sendId && emails.length > 0) {
    trackedLinks = injectTracking(baseHtml, "probe", sendId).links
  }

  callbacks?.onStart?.(emails.length)

  let sent = 0
  const failedRecipients: string[] = []

  const BATCH = 10
  const BATCH_DELAY_MS = 1000
  for (let i = 0; i < emails.length; i += BATCH) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    const batch = emails.slice(i, i + BATCH)
    await Promise.allSettled(
      batch.map(async email => {
        let html = baseHtml
        if (opts.trackingEnabled && sendId) {
          html = injectTracking(baseHtml, randomUUID(), sendId).html
        }
        try {
          await client.send(
            new SendEmailCommand({
              FromEmailAddress: from,
              ReplyToAddresses: replyTo,
              Destination: { ToAddresses: [email] },
              Content: {
                Simple: {
                  Subject: { Data: subject },
                  Body: { Html: { Data: html } },
                },
              },
              ListManagementOptions: { ContactListName: CONTACT_LIST, TopicName: listName },
            })
          )
          sent++
          callbacks?.onResult?.(email, "sent")
        } catch (err) {
          console.error(`[ses] resend failed to ${email}:`, err)
          failedRecipients.push(email)
          callbacks?.onResult?.(email, "failed")
        }
      })
    )
  }

  return { sent, failed: failedRecipients.length, failedRecipients, trackedLinks }
}

export async function sendTestEmail(
  newsletter: NewsletterItem,
  toEmail: string,
  opts: SendOpts = {},
  sendId?: string
): Promise<{ trackedLinks: string[] }> {
  let html = buildNewsletterHtml(newsletter, "light", true, opts.includeWebLink)
  let trackedLinks: string[] = []
  if (opts.trackingEnabled && sendId) {
    const result = injectTracking(html, randomUUID(), sendId)
    html = result.html
    trackedLinks = result.links
  }
  const subject = opts.subject ? `[TEST] ${opts.subject}` : `[TEST] ${newsletter.title}`
  const replyTo = opts.replyTo ? [opts.replyTo] : undefined
  const from = buildFrom(opts.fromName)
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      ReplyToAddresses: replyTo,
      Destination: { ToAddresses: [toEmail] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: { Html: { Data: html } },
        },
      },
    })
  )
  return { trackedLinks }
}
