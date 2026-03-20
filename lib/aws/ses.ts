import {
  SESv2Client,
  ListContactListsCommand,
  CreateContactListCommand,
  DeleteContactListCommand,
  ListContactsCommand,
  CreateContactCommand,
  DeleteContactCommand,
  SendEmailCommand,
  CreateImportJobCommand,
  GetImportJobCommand,
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

export async function listContactLists(): Promise<{ name: string; description?: string }[]> {
  const res = await client.send(new ListContactListsCommand({}))
  return (res.ContactLists ?? []).map(l => ({
    name: l.ContactListName!,
  }))
}

export async function createContactList(name: string, description?: string): Promise<void> {
  await client.send(
    new CreateContactListCommand({
      ContactListName: name,
      Description: description,
    })
  )
}

export async function deleteContactList(name: string): Promise<void> {
  await client.send(new DeleteContactListCommand({ ContactListName: name }))
}

export async function listContacts(
  listName: string
): Promise<{ email: string; unsubscribed: boolean }[]> {
  const contacts: { email: string; unsubscribed: boolean }[] = []
  let nextToken: string | undefined

  do {
    const res = await client.send(
      new ListContactsCommand({
        ContactListName: listName,
        NextToken: nextToken,
      })
    )
    for (const c of res.Contacts ?? []) {
      contacts.push({
        email: c.EmailAddress!,
        unsubscribed: c.UnsubscribeAll ?? false,
      })
    }
    nextToken = res.NextToken
  } while (nextToken)

  return contacts
}

export async function createContact(listName: string, email: string): Promise<void> {
  await client.send(
    new CreateContactCommand({
      ContactListName: listName,
      EmailAddress: email,
    })
  )
}

export async function createContacts(
  listName: string,
  emails: string[]
): Promise<{ added: number; failed: number; processedCount: number }> {
  const bucket = process.env.S3_BUCKET_NAME!
  const key = `ses-imports/${randomUUID()}.csv`

  // Build CSV — SES expects a header row with at least emailAddress
  const csv = ["emailAddress", ...emails].join("\n")

  // Upload to S3 so SES can read it
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: csv,
    ContentType: "text/csv",
  }))

  // Create the import job
  const job = await client.send(new CreateImportJobCommand({
    ImportDestination: {
      ContactListDestination: {
        ContactListName: listName,
        ContactListImportAction: "PUT",
      },
    },
    ImportDataSource: {
      S3Url: `s3://${bucket}/${key}`,
      DataFormat: "CSV",
    },
  }))

  const jobId = job.JobId!

  // Poll until the job completes (max ~30s)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const status = await client.send(new GetImportJobCommand({ JobId: jobId }))
    if (status.JobStatus === "COMPLETED") {
      return { added: emails.length, failed: 0 }
    }
    if (status.JobStatus === "FAILED") {
      console.error("[ses] import job failed:", status.FailureInfo)
      return { added: 0, failed: emails.length }
    }
  }

  // Timed out — job is still running
  return { added: 0, failed: 0 }
}

export async function deleteContact(listName: string, email: string): Promise<void> {
  await client.send(
    new DeleteContactCommand({
      ContactListName: listName,
      EmailAddress: email,
    })
  )
}

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

  // Pre-capture tracked links once (same for all recipients)
  let trackedLinks: string[] = []
  if (opts.trackingEnabled && sendId && active.length > 0) {
    trackedLinks = injectTracking(baseHtml, "probe", sendId).links
  }

  console.log(JSON.stringify({ event: "send_start", sendId, listName, total: active.length, ts: new Date().toISOString() }))
  callbacks?.onStart?.(active.length)

  let sent = 0
  const failedRecipients: string[] = []

  // 10 per batch, 1s between batches → max 10/s, well under the 14/s SES limit
  const BATCH = 10
  const BATCH_DELAY_MS = 1000
  for (let i = 0; i < active.length; i += BATCH) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    const batch = active.slice(i, i + BATCH)
    await Promise.allSettled(
      batch.map(async contact => {
        let html = baseHtml
        if (opts.trackingEnabled && sendId) {
          const messageId = randomUUID()
          html = injectTracking(baseHtml, messageId, sendId).html
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
              ListManagementOptions: { ContactListName: listName },
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
          const messageId = randomUUID()
          html = injectTracking(baseHtml, messageId, sendId).html
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
              ListManagementOptions: { ContactListName: listName },
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
    const messageId = randomUUID()
    const result = injectTracking(html, messageId, sendId)
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
