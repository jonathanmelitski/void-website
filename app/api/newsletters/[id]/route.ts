import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import {
  getNewsletter,
  getNewsletterBySlug,
  setNewsletterPublished,
  updateNewsletterBody,
  updateNewsletterMeta,
  deleteNewsletter,
} from "@/lib/aws/newsletters"
import { logAudit } from "@/lib/aws/audit"

type Params = { params: Promise<{ id: string }> }

async function getCallerInfo(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  try {
    const payload = await verifyToken(token)
    return {
      groups: (payload["cognito:groups"] ?? []) as string[],
      username: (payload["cognito:username"] ?? payload.sub ?? "") as string,
    }
  } catch {
    return null
  }
}

function isCoachOrAdmin(groups: string[]) {
  return groups.includes("COACH") || groups.includes("ADMIN")
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const newsletter = (await getNewsletter(id)) ?? (await getNewsletterBySlug(id))
  if (!newsletter) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (newsletter.published) return NextResponse.json(newsletter)

  const caller = await getCallerInfo(request)
  if (caller && isCoachOrAdmin(caller.groups)) return NextResponse.json(newsletter)

  return NextResponse.json({ error: "Not found" }, { status: 404 })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const caller = await getCallerInfo(request)
  if (!caller) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!isCoachOrAdmin(caller.groups)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const newsletter = await getNewsletter(id)
  if (!newsletter) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const newPublished = !newsletter.published
  await setNewsletterPublished(id, newPublished)
  void logAudit({
    actorUsername: caller.username,
    action: newPublished ? "PUBLISH" : "UNPUBLISH",
    entityType: "NEWSLETTER",
    entityId: id,
    entityLabel: newsletter.title,
    previousState: { published: newsletter.published },
    reversible: true,
  })
  return NextResponse.json({ ...newsletter, published: newPublished })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params
  const caller = await getCallerInfo(request)
  if (!caller) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!isCoachOrAdmin(caller.groups)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const newsletter = await getNewsletter(id)

  const payload = await request.json()

  if (typeof payload.body === "string") {
    await updateNewsletterBody(id, payload.body)
  }

  const { title, slug, date, coverPhotoKey } = payload
  const meta: Record<string, string> = {}
  if (typeof title === "string") meta.title = title
  if (typeof slug === "string") meta.slug = slug
  if (typeof date === "string") meta.date = date
  if (typeof coverPhotoKey === "string") meta.coverPhotoKey = coverPhotoKey
  if (Object.keys(meta).length > 0) await updateNewsletterMeta(id, meta)

  void logAudit({
    actorUsername: caller.username,
    action: "UPDATE",
    entityType: "NEWSLETTER",
    entityId: id,
    entityLabel: newsletter?.title ?? id,
    previousState: newsletter as Record<string, unknown> ?? undefined,
    reversible: !!newsletter,
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const caller = await getCallerInfo(request)
  if (!caller) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!caller.groups.includes("ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const newsletter = await getNewsletter(id)
  await deleteNewsletter(id)
  void logAudit({
    actorUsername: caller.username,
    action: "DELETE",
    entityType: "NEWSLETTER",
    entityId: id,
    entityLabel: newsletter?.title ?? id,
    previousState: newsletter as Record<string, unknown> ?? undefined,
    reversible: !!newsletter,
  })
  return NextResponse.json({ success: true })
}
