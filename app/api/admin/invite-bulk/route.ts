import { NextRequest, NextResponse } from "next/server"
import { requireUser, ADMIN_ONLY } from "@/lib/auth/server"

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ADMIN_ONLY })
  if (!auth.ok) return auth.response

  const { emails: rawEmails, role = "USER" } = await request.json()
  if (!rawEmails) return NextResponse.json({ error: "emails is required" }, { status: 400 })

  // Accept array or newline/comma-separated string
  const emailList: string[] = Array.isArray(rawEmails)
    ? rawEmails
    : String(rawEmails).split(/[\n,]+/)

  const emails = [...new Set(emailList.map(e => e.trim()).filter(Boolean))]
  if (emails.length === 0) return NextResponse.json({ error: "No valid emails provided" }, { status: 400 })

  const results = await Promise.allSettled(
    emails.map(email =>
      fetch(`${request.nextUrl.origin}/api/admin/invite-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({ email, role }),
      }).then(async res => {
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? `HTTP ${res.status}`)
        }
        return email
      })
    )
  )

  const succeeded: string[] = []
  const failed: Array<{ email: string; error: string }> = []

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      succeeded.push(emails[i])
    } else {
      failed.push({ email: emails[i], error: result.reason?.message ?? "Unknown error" })
    }
  })

  return NextResponse.json({ succeeded, failed })
}
