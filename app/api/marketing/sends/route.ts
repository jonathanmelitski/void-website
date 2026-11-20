import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { listSends } from "@/lib/aws/sends"


export async function GET(request: NextRequest) {
  const caller = await requireUser(request, { permission: "marketing.send" })
  if (!caller.ok) return caller.response

  const sends = await listSends()
  return NextResponse.json(sends)
}
