import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { listEvents, createEvent } from "@/lib/aws/dynamo"
import { randomUUID } from "crypto"

export async function GET() {
  try {
    const events = await listEvents()
    return NextResponse.json(events)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch events"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const groups = payload["cognito:groups"] ?? []
  if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { title, date, location, description, coverPhotoKey } = await request.json()
  if (!title || !date) {
    return NextResponse.json({ error: "Title and date are required" }, { status: 400 })
  }

  const item = {
    id: randomUUID(),
    title,
    date,
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(coverPhotoKey ? { coverPhotoKey } : {}),
    createdAt: new Date().toISOString(),
  }

  try {
    await createEvent(item)
    return NextResponse.json(item, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
