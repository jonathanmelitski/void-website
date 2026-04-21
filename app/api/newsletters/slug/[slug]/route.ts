import { NextRequest, NextResponse } from "next/server"
import { getNewsletterBySlug } from "@/lib/aws/newsletters"

type Params = { params: Promise<{ slug: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  const { slug } = await params
  const newsletter = await getNewsletterBySlug(slug)
  if (!newsletter || !newsletter.published) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json(newsletter)
}
