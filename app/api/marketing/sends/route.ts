import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { listSends } from "@/lib/aws/sends"


export async function GET(request: NextRequest) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const sends = await listSends()
  return NextResponse.json(sends)
}
