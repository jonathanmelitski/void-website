import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { verifyToken } from "@/lib/aws/cognito"
import {
  listNewsletters,
  createNewsletter,
  generateSlug,
  type NewsletterItem,
} from "@/lib/aws/newsletters"
import { randomUUID } from "crypto"

async function getCallerGroups(request: NextRequest): Promise<string[]> {
  const token = request.cookies.get("access_token")?.value
  if (!token) return []
  try {
    const payload = await verifyToken(token)
    return payload["cognito:groups"] ?? []
  } catch {
    return []
  }
}

function isCoachOrAdmin(groups: string[]) {
  return groups.includes("COACH") || groups.includes("ADMIN")
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const all = searchParams.get("all") === "true"

  if (all) {
    const token = request.cookies.get("access_token")?.value
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    try {
      const payload = await verifyToken(token)
      const groups = payload["cognito:groups"] ?? []
      if (!isCoachOrAdmin(groups)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }
    const newsletters = await listNewsletters()
    return NextResponse.json(newsletters)
  }

  const newsletters = await listNewsletters()
  return NextResponse.json(newsletters.filter(n => n.published))
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let groups: string[]
  try {
    const payload = await verifyToken(token)
    groups = payload["cognito:groups"] ?? []
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  if (!isCoachOrAdmin(groups)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json()
  const { title, date, coverPhotoKey, slug: rawSlug } = body

  if (!title || !date) {
    return NextResponse.json({ error: "title and date are required" }, { status: 400 })
  }

  const item: NewsletterItem = {
    id: randomUUID(),
    slug: rawSlug ? String(rawSlug) : generateSlug(title),
    title,
    date,
    coverPhotoKey,
    published: false,
    entries: [],
    createdAt: new Date().toISOString(),
  }

  await createNewsletter(item)
  revalidatePath("/news", "layout")
  return NextResponse.json(item, { status: 201 })
}
