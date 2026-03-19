import {
  SESv2Client,
  ListContactListsCommand,
  CreateContactListCommand,
  DeleteContactListCommand,
  ListContactsCommand,
  CreateContactCommand,
  DeleteContactCommand,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2"
import { buildNewsletterHtml } from "@/lib/newsletter-html"
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
}

function buildFrom(name?: string): string {
  const email = process.env.SES_FROM_EMAIL!
  return name ? `"${name}" <${email}>` : email
}

export async function sendNewsletterToList(
  _newsletterId: string,
  newsletter: NewsletterItem,
  listName: string,
  opts: SendOpts = {}
): Promise<{ sent: number }> {
  const contacts = await listContacts(listName)
  const active = contacts.filter(c => !c.unsubscribed)
  const html = buildNewsletterHtml(newsletter, "light", true, opts.includeWebLink)
  const subject = opts.subject || newsletter.title
  const replyTo = opts.replyTo ? [opts.replyTo] : undefined
  const from = buildFrom(opts.fromName)

  const BATCH = 10
  for (let i = 0; i < active.length; i += BATCH) {
    const batch = active.slice(i, i + BATCH)
    await Promise.all(
      batch.map(contact =>
        client.send(
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
      )
    )
  }

  return { sent: active.length }
}

export async function sendTestEmail(
  newsletter: NewsletterItem,
  toEmail: string,
  opts: SendOpts = {}
): Promise<void> {
  const html = buildNewsletterHtml(newsletter, "light", true, opts.includeWebLink)
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
}
