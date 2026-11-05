"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { PageContainer } from "@/components/ui/page"
import { CodeInput, FormMessage, postAuth } from "@/components/auth/auth-form"

const RESEND_COOLDOWN = 30

function ConfirmForm() {
  const searchParams = useSearchParams()
  const emailParam = searchParams.get("email") ?? ""
  const [email, setEmail] = useState(emailParam)
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState(searchParams.get("sent") ? "We sent a new code. It can take a minute to arrive." : "")
  const [isLoading, setIsLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(searchParams.get("sent") ? RESEND_COOLDOWN : 0)
  const router = useRouter()

  // Count the resend cooldown down
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setNotice("")
    setIsLoading(true)
    try {
      const res = await postAuth("/api/auth/confirm", { email, code })
      if (!res.ok && res.code !== "ALREADY_CONFIRMED") { setError(res.error); return }
      router.push(`/live/login?email=${encodeURIComponent(email)}&notice=confirmed`)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleResend() {
    if (!email) { setError("Enter your email first."); return }
    setError("")
    setNotice("")
    setResending(true)
    try {
      const res = await postAuth("/api/auth/confirm", { email, resend: true })
      if (!res.ok) { setError(res.error); return }
      setNotice("We sent a new code. It can take a minute to arrive.")
      setCooldown(RESEND_COOLDOWN)
    } finally {
      setResending(false)
    }
  }

  return (
    <PageContainer width="form" className="flex flex-col gap-6 text-left">
      <div>
        <h1 className="text-4xl font-display leading-none tracking-wide">Check your email</h1>
        <p className="text-fg-muted mt-2 text-sm">
          {emailParam ? `Enter the 6-digit code we sent to ${emailParam}.` : "Enter the 6-digit code we emailed you."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {!emailParam && (
          <Field label="Email">
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@upenn.edu" required autoComplete="email" className="h-10" />
          </Field>
        )}
        <Field label="Confirmation code">
          <CodeInput id="code" value={code} onValueChange={setCode} placeholder="123456" required />
        </Field>
        <FormMessage error={error} notice={notice} />
        <Button type="submit" size="lg" loading={isLoading} disabled={code.length !== 6}>
          {isLoading ? "Confirming…" : "Confirm account"}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Button type="button" variant="quiet" onClick={handleResend} disabled={resending || cooldown > 0}>
          {resending ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Button>
        <Link href="/live/login" className="text-fg-muted hover:text-foreground transition-colors">Back to sign in</Link>
      </div>
    </PageContainer>
  )
}

export default function ConfirmPage() {
  return <Suspense><ConfirmForm /></Suspense>
}
