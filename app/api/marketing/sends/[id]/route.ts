import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/aws/cognito"
import { getSend, deleteSend } from "@/lib/aws/sends"
import { deleteEventsForSend } from "@/lib/aws/tracking"

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value
  if (!token) return null
  try {
    const payload = await verifyToken(token)
    const groups: string[] = payload["cognito:groups"] ?? []
    if (!groups.includes("ADMIN")) return null
    return true
  } catch {
    return null
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const send = await getSend(id)
  if (!send) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(send)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const send = await getSend(id)
  if (!send) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await Promise.all([deleteSend(id), deleteEventsForSend(id)])
  return NextResponse.json({ success: true })
}
