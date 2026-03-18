import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

const TABLE = () => process.env.DYNAMO_NEWSLETTERS_TABLE!

export type NewsletterEntry = {
  id: string
  title: string
  body: string // HTML from TipTap
  authorUsername: string
  createdAt: string
  date?: string // display date shown publicly, e.g. "March 2026"
}

export type NewsletterItem = {
  id: string
  slug: string
  title: string
  body?: string // HTML shown before entries
  date: string // ISO date, used for sorting
  coverPhotoKey?: string
  published: boolean
  entries: NewsletterEntry[]
  createdAt: string
}

export function generateSlug(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export async function listNewsletters(): Promise<NewsletterItem[]> {
  const result = await dynamo.send(new ScanCommand({ TableName: TABLE() }))
  const items = (result.Items ?? []) as NewsletterItem[]
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export async function getNewsletterBySlug(slug: string): Promise<NewsletterItem | null> {
  const result = await dynamo.send(new ScanCommand({
    TableName: TABLE(),
    FilterExpression: "#slug = :slug",
    ExpressionAttributeNames: { "#slug": "slug" },
    ExpressionAttributeValues: { ":slug": slug },
  }))
  return (result.Items?.[0] as NewsletterItem) ?? null
}

export async function getNewsletter(id: string): Promise<NewsletterItem | null> {
  const result = await dynamo.send(
    new GetCommand({ TableName: TABLE(), Key: { id } })
  )
  return (result.Item as NewsletterItem) ?? null
}

export async function createNewsletter(item: NewsletterItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: TABLE(), Item: item }))
}

export async function deleteNewsletter(id: string): Promise<void> {
  await dynamo.send(new DeleteCommand({ TableName: TABLE(), Key: { id } }))
}

export async function updateNewsletterEntries(id: string, entries: NewsletterEntry[]): Promise<void> {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { id },
      UpdateExpression: "SET entries = :entries",
      ExpressionAttributeValues: { ":entries": entries },
    })
  )
}

export async function updateNewsletterBody(id: string, body: string): Promise<void> {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { id },
      UpdateExpression: "SET body = :body",
      ExpressionAttributeValues: { ":body": body },
    })
  )
}

export async function updateNewsletterMeta(
  id: string,
  fields: Partial<Pick<NewsletterItem, "title" | "slug" | "date" | "coverPhotoKey">>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return
  const sets = entries.map(([k], i) => `#f${i} = :v${i}`)
  const names = Object.fromEntries(entries.map(([k], i) => [`#f${i}`, k]))
  const values = Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v]))
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { id },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  )
}

export async function setNewsletterPublished(id: string, published: boolean): Promise<void> {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { id },
      UpdateExpression: "SET published = :val",
      ExpressionAttributeValues: { ":val": published },
    })
  )
}

export async function appendNewsletterEntry(
  id: string,
  entry: NewsletterEntry
): Promise<void> {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { id },
      UpdateExpression:
        "SET entries = list_append(if_not_exists(entries, :empty), :entry)",
      ExpressionAttributeValues: {
        ":empty": [],
        ":entry": [entry],
      },
    })
  )
}

export async function removeNewsletterEntry(
  newsletterId: string,
  entryId: string
): Promise<void> {
  const newsletter = await getNewsletter(newsletterId)
  if (!newsletter) return
  const updated = (newsletter.entries ?? []).filter(e => e.id !== entryId)
  await dynamo.send(
    new PutCommand({
      TableName: TABLE(),
      Item: { ...newsletter, entries: updated },
    })
  )
}
