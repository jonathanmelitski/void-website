import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getAnnotation, updateAnnotation, deleteAnnotation } from "@/lib/aws/film-annotations"
import { pushFilmUpdate } from "@/lib/ws-push"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const annotation = await getAnnotation(id)
  if (!annotation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const groups = payload["cognito:groups"] ?? []
  const username = payload["cognito:username"] ?? payload.sub
  const isAuthor = annotation.authorUsername === username
  const isAdmin = groups.includes("ADMIN")
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { text } = await request.json()
  if (!text || text.length > 500) {
    return NextResponse.json({ error: "text is required and must be ≤500 characters" }, { status: 400 })
  }

  const updatedAt = new Date().toISOString()
  try {
    await updateAnnotation(id, { text, updatedAt })
    const updated = { ...annotation, text, updatedAt }
    pushFilmUpdate(annotation.clipId, { type: "ANNOTATION_UPDATED", annotation: updated, ts: Date.now() })
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

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const annotation = await getAnnotation(id)
  if (!annotation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const groups = payload["cognito:groups"] ?? []
  const username = payload["cognito:username"] ?? payload.sub
  const isAuthor = annotation.authorUsername === username
  const isAdmin = groups.includes("ADMIN")
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    await deleteAnnotation(id)
    pushFilmUpdate(annotation.clipId, { type: "ANNOTATION_DELETED", annotation, ts: Date.now() })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete annotation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
