import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { can } from "@/lib/permissions/catalog"
import { getAnnotation, updateAnnotation, deleteAnnotation, setAnnotationPoint } from "@/lib/aws/film-annotations"
import { getPoint } from "@/lib/aws/points"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { username } = auth

  const annotation = await getAnnotation(id)
  if (!annotation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const isAuthor = annotation.authorUsername === username
  if (!isAuthor && !can(auth.permissions, "film.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const updatedAt = new Date().toISOString()

  // Link to a point / unlink ("untag"). Body: { pointId: string | null }
  if (body && "pointId" in body) {
    const pointId: unknown = body.pointId
    if (pointId !== null && typeof pointId !== "string") {
      return NextResponse.json({ error: "pointId must be a point ID or null" }, { status: 400 })
    }
    if (typeof pointId === "string") {
      const point = await getPoint(pointId)
      if (!point || point.gameId !== annotation.gameId) {
        return NextResponse.json({ error: "That point isn't in this game." }, { status: 400 })
      }
    }
    try {
      await setAnnotationPoint(id, pointId, updatedAt)
      const next: typeof annotation = { ...annotation, updatedAt }
      delete next.pointEventId
      if (pointId) next.pointId = pointId
      else delete next.pointId
      return NextResponse.json(next)
    } catch {
      return NextResponse.json({ error: "Couldn't update the note" }, { status: 500 })
    }
  }

  const text: unknown = body?.text
  if (typeof text !== "string" || !text || text.length > 500) {
    return NextResponse.json({ error: "text is required and must be ≤500 characters" }, { status: 400 })
  }

  try {
    await updateAnnotation(id, { text, updatedAt })
    const updated = { ...annotation, text, updatedAt }
    return NextResponse.json(updated)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update annotation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { username } = auth

  const annotation = await getAnnotation(id)
  if (!annotation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const isAuthor = annotation.authorUsername === username
  if (!isAuthor && !can(auth.permissions, "film.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    await deleteAnnotation(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete annotation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
