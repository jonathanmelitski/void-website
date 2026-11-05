import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { deletePointEvent } from "@/lib/aws/point-events"
import { pushGameUpdate } from "@/lib/ws-push"

interface Props {
  params: Promise<{ id: string }>
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { id } = await params
  const gameId = request.nextUrl.searchParams.get("gameId")
  try {
    await deletePointEvent(id)
    if (gameId) pushGameUpdate(gameId).catch(() => {})
    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete point event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
