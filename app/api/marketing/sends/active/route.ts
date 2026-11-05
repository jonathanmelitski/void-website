import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"
import { listSends, summarizeSend } from "@/lib/aws/sends"
import { isActiveState, sendState } from "@/lib/bulk-send"
import { emailWorkerEnabled } from "@/lib/aws/email-worker"

// Active and recent list sends (summaries), so the panel can re-attach its progress monitor after a reload.
export async function GET(request: NextRequest) {
  const caller = await requireUser(request, { roles: ADMIN_ONLY })
  if (!caller.ok) return caller.response

  const sends = (await listSends(200)).filter(s => s.sendMode !== "test")
  const now = Date.now()
  return NextResponse.json({
    workerEnabled: emailWorkerEnabled(),
    active: sends.filter(s => isActiveState(sendState(s, now))).map(summarizeSend),
    recent: sends.slice(0, 10).map(summarizeSend),
  })
}
