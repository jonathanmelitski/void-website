import { NextRequest, NextResponse } from "next/server"
import { listEventPhotos } from "@/lib/aws/s3"

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params
  try {
    const urls = await listEventPhotos(id)
    return NextResponse.json(urls)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list photos"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
