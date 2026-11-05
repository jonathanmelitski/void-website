"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { PageContainer } from "@/components/ui/page"
import { FormMessage, postAuth } from "@/components/auth/auth-form"

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(searchParams.get("email") ?? "")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      const res = await postAuth("/api/auth/reset-password", { email })
      if (!res.ok) { setError(res.error); return }
      router.push(`/live/confirm-reset?email=${encodeURIComponent(email)}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <PageContainer width="form" className="flex flex-col gap-6 text-left">
      <div>
        <h1 className="text-4xl font-display leading-none tracking-wide">Reset password</h1>
        <p className="text-fg-muted mt-2 text-sm">We&apos;ll email you a code to set a new password.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@upenn.edu" required autoComplete="email" className="h-10" />
        </Field>
        <FormMessage error={error} />
        <Button type="submit" size="lg" loading={isLoading}>
          {isLoading ? "Sending…" : "Send reset code"}
        </Button>
      </form>

      <Link href="/live/login" className="text-sm text-fg-muted hover:text-foreground transition-colors w-fit">
        Back to sign in
      </Link>
    </PageContainer>
  )
}

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordForm /></Suspense>
}
