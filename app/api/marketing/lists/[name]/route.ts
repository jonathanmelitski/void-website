import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { deleteContactList } from "@/lib/aws/ses"

type Params = { params: Promise<{ name: string }> }


export async function DELETE(request: NextRequest, { params }: Params) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const { name } = await params
  await deleteContactList(name)
  return new NextResponse(null, { status: 204 })
}
