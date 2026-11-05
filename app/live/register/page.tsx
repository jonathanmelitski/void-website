"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { PageContainer } from "@/components/ui/page"
import { FormMessage, PasswordInput, postAuth } from "@/components/auth/auth-form"
import { PASSWORD_RULES } from "@/lib/auth-errors"

export default function RegisterPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [mismatch, setMismatch] = useState(false)
  const [error, setError] = useState("")
  const [exists, setExists] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setExists(false)
    if (password !== confirm) { setMismatch(true); return }
    setIsLoading(true)
    try {
      const res = await postAuth("/api/auth/register", { email, password })
      if (!res.ok) {
        setError(res.error)
        setExists(res.code === "EXISTS")
        return
      }
      router.push(`/live/confirm?email=${encodeURIComponent(email)}&sent=1`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <PageContainer width="form" className="flex flex-col gap-6 text-left">
      <div>
        <h1 className="text-4xl font-display leading-none tracking-wide">Create account</h1>
        <p className="text-fg-muted mt-2 text-sm">For Void players and coaches. Use your team email to get to your game footage.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@upenn.edu" required autoComplete="email" className="h-10" />
        </Field>
        <Field label="Password" hint={PASSWORD_RULES}>
          <PasswordInput id="password" value={password}
            onChange={e => { setPassword(e.target.value); setMismatch(false) }}
            required autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" error={mismatch ? "Passwords don't match." : undefined}>
          <PasswordInput id="confirm" value={confirm}
            onChange={e => { setConfirm(e.target.value); setMismatch(false) }}
            required autoComplete="new-password" />
        </Field>
        <FormMessage error={error} />
        <Button type="submit" size="lg" loading={isLoading}>
          {isLoading ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <Link
        href={exists ? `/live/login?email=${encodeURIComponent(email)}` : "/live/login"}
        className="text-sm text-fg-muted hover:text-foreground transition-colors w-fit"
      >
        Already have an account? Sign in
      </Link>
    </PageContainer>
  )
}
