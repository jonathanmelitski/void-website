import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { getSend, deleteSend, summarizeSend } from "@/lib/aws/sends"
import { deleteEventsForSend } from "@/lib/aws/tracking"


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireUser(request, { roles: ADMIN_ONLY })
  if (!admin.ok) return admin.response

  const { id } = await params
  const send = await getSend(id)
  if (!send) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // ?summary=1: counts and status only (the progress monitor polls this every ~2 s).
  if (request.nextUrl.searchParams.get("summary") === "1") return NextResponse.json(summarizeSend(send))
  return NextResponse.json(send)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireUser(request, { roles: ADMIN_ONLY })
  if (!admin.ok) return admin.response

  const { id } = await params
  const send = await getSend(id)
  if (!send) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await Promise.all([deleteSend(id), deleteEventsForSend(id)])
  return NextResponse.json({ success: true })
}
