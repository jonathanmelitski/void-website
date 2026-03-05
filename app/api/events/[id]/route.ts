import { NextRequest, NextResponse } from "next/server"
import { getEvent } from "@/lib/aws/dynamo"

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const event = await getEvent(id)
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(event)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch event"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
