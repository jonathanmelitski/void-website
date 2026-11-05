"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { PageContainer } from "@/components/ui/page"
import { CodeInput, FormMessage, PasswordInput, postAuth } from "@/components/auth/auth-form"
import { PASSWORD_RULES } from "@/lib/auth-errors"

function ConfirmResetForm() {
  const searchParams = useSearchParams()
  const email = searchParams.get("email") ?? ""
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [mismatch, setMismatch] = useState(false)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password !== confirm) { setMismatch(true); return }
    setIsLoading(true)
    try {
      const res = await postAuth("/api/auth/confirm-reset", { email, code, password })
      if (!res.ok) { setError(res.error); return }
      router.push(`/live/login?email=${encodeURIComponent(email)}&notice=reset`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <PageContainer width="form" className="flex flex-col gap-6 text-left">
      <div>
        <h1 className="text-4xl font-display leading-none tracking-wide">Set new password</h1>
        {/* Same copy whether or not an account exists for this email */}
        <p className="text-fg-muted mt-2 text-sm">
          {email
            ? `If there's an account for ${email}, we've emailed it a 6-digit code.`
            : "Enter the 6-digit code we emailed you."}
        </p>
      </div>

      {!email ? (
        <FormMessage error="This link is missing your email. Start the reset again." />
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Reset code">
            <CodeInput id="code" value={code} onValueChange={setCode} placeholder="123456" required />
          </Field>
          <Field label="New password" hint={PASSWORD_RULES}>
            <PasswordInput id="password" value={password}
              onChange={e => { setPassword(e.target.value); setMismatch(false) }}
              required autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" error={mismatch ? "Passwords don't match." : undefined}>
            <PasswordInput id="confirm" value={confirm}
              onChange={e => { setConfirm(e.target.value); setMismatch(false) }}
              required autoComplete="new-password" />
          </Field>
          <FormMessage error={error} />
          <Button type="submit" size="lg" loading={isLoading} disabled={code.length !== 6}>
            {isLoading ? "Saving…" : "Set new password"}
          </Button>
        </form>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link
          href={email ? `/live/reset-password?email=${encodeURIComponent(email)}` : "/live/reset-password"}
          className="text-fg-muted hover:text-foreground transition-colors"
        >
          Send a new code
        </Link>
        <Link href="/live/login" className="text-fg-muted hover:text-foreground transition-colors">
          Back to sign in
        </Link>
      </div>
    </PageContainer>
  )
}

export default function ConfirmResetPage() {
  return <Suspense><ConfirmResetForm /></Suspense>
}
