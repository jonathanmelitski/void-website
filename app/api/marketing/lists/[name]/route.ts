import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { deleteContactList } from "@/lib/aws/ses"

type Params = { params: Promise<{ name: string }> }


export async function DELETE(request: NextRequest, { params }: Params) {
  const caller = await requireUser(request, { permission: "marketing.send" })
  if (!caller.ok) return caller.response

  const { name } = await params
  await deleteContactList(name)
  return new NextResponse(null, { status: 204 })
}
