import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { listContactLists } from "@/lib/aws/ses"
import { SubscribeForm } from "./SubscribeForm"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ name: string }> }

// Public names for the SES list slugs. Unknown slugs fall back to a tidied version of the slug.
const LIST_NAMES: Record<string, { title: string; description: string }> = {
  "void-public": {
    title: "the Void newsletter",
    description: "Results, recaps and team news, about once a month.",
  },
  "void-alumni": {
    title: "Void alumni updates",
    description: "News from the team and alumni events, a few times a season.",
  },
  "void-roster": {
    title: "team updates",
    description: "Practice, travel and tournament updates for current players.",
  },
}

function displayFor(slug: string) {
  const known = LIST_NAMES[slug]
  if (known) return known
  const words = slug.replace(/^void-/, "").replace(/[-_]+/g, " ").trim()
  return {
    title: words ? `Void ${words} updates` : "Void updates",
    description: "Updates from Void Ultimate.",
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params
  const { title } = displayFor(decodeURIComponent(name))
  return { title: "Subscribe", description: `Subscribe to ${title}.` }
}

export default async function SubscribePage({ params }: Props) {
  const { name } = await params
  const listName = decodeURIComponent(name)

  // Unknown list: branded 404 instead of a form that only fails after submitting.
  // If the lookup itself fails, still show the form (the submit reports any problem).
  let exists = true
  try {
    const lists = await listContactLists()
    exists = lists.some(l => l.name === listName)
  } catch {
    exists = true
  }
  if (!exists) notFound()

  const { title, description } = displayFor(listName)
  return <SubscribeForm listName={listName} listTitle={title} listDescription={description} />
}
