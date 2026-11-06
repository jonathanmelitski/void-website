import { NextRequest, NextResponse } from "next/server"
import { requireUser, COACH_OR_ADMIN } from "@/lib/auth/server"
import { deletePointEvent, getPointEvent, updatePointEventWho } from "@/lib/aws/point-events"
import { eventNeedsPlayer, TURNOVER_TYPES, type TurnoverType } from "@/lib/point-event-meta"
import { pushGameUpdate } from "@/lib/ws-push"

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Change who did an event (player; sub out/in; timeout or pull team; pull in/out) without touching
 * its time, order or type, so film sync stays exact.
 */
export async function PATCH(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

  const { id } = await params
  const body = await request.json() as { playerId?: string; playerInId?: string; team?: "VOID" | "OPP"; pullResult?: "IN" | "OUT"; turnoverType?: TurnoverType }
  try {
    const ev = await getPointEvent(id)
    if (!ev) return NextResponse.json({ error: "That event no longer exists." }, { status: 404 })

    const next = { ...ev, ...body }
    if (body.team !== undefined && body.team !== "VOID" && body.team !== "OPP") {
      return NextResponse.json({ error: "team must be VOID or OPP" }, { status: 400 })
    }
    if (body.team !== undefined && ev.eventType !== "TIMEOUT" && ev.eventType !== "PULL") {
      return NextResponse.json({ error: "Only timeouts and pulls have a team." }, { status: 400 })
    }
    if (body.pullResult !== undefined && (ev.eventType !== "PULL" || (body.pullResult !== "IN" && body.pullResult !== "OUT"))) {
      return NextResponse.json({ error: "pullResult must be IN or OUT on a pull." }, { status: 400 })
    }
    if (body.turnoverType !== undefined && ((ev.eventType !== "TURNOVER" && ev.eventType !== "OPP_TURNOVER") || !TURNOVER_TYPES.includes(body.turnoverType))) {
      return NextResponse.json({ error: "Not a valid turnover type." }, { status: 400 })
    }
    if (body.playerInId !== undefined && ev.eventType !== "SUBSTITUTION") {
      return NextResponse.json({ error: "Only subs have a player coming in." }, { status: 400 })
    }
    // An opponent pull has no Void player; switching a pull to the opponent clears it.
    const opponentPull = ev.eventType === "PULL" && next.team === "OPP"
    const playerId = opponentPull ? "" : next.playerId
    if (eventNeedsPlayer(ev.eventType, next.team) && !playerId) {
      return NextResponse.json({ error: "Pick a player." }, { status: 400 })
    }
    if (ev.eventType === "SUBSTITUTION" && (!next.playerInId || next.playerInId === playerId)) {
      return NextResponse.json({ error: "Pick who went out and who came in." }, { status: 400 })
    }

    await updatePointEventWho(id, {
      playerId: eventNeedsPlayer(ev.eventType, next.team) || opponentPull ? playerId : undefined,
      playerInId: ev.eventType === "SUBSTITUTION" ? next.playerInId : undefined,
      team: body.team,
      pullResult: body.pullResult,
      turnoverType: body.turnoverType,
    })
    pushGameUpdate(ev.gameId).catch(() => {})
    return NextResponse.json(await getPointEvent(id))
  } catch (err: unknown) {
    console.error(JSON.stringify({ event: "point_event_patch_failed", id, error: err instanceof Error ? err.message : String(err) }))
    return NextResponse.json({ error: "Couldn't save the change. Try again." }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const auth = await requireUser(request, { roles: COACH_OR_ADMIN })
  if (!auth.ok) return auth.response

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
