import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { getPlayer, updatePlayer, deletePlayer } from "@/lib/aws/players"

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const player = await getPlayer(id)
    if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(player)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch player"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { id } = await params
  const fields = await request.json()

  try {
    await updatePlayer(id, fields)
    const updated = await getPlayer(id)
    return NextResponse.json(updated)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update player"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response
  const { payload, groups } = auth

  const { id } = await params
  try {
    await deletePlayer(id)
    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete player"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
