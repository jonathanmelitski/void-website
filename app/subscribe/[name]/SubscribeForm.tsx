"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2, MailCheck } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type Props = {
  /** SES list slug used by the API (never shown). */
  listName: string
  /** Human name, e.g. "the Void newsletter". */
  listTitle: string
  listDescription: string
}

type Status = "idle" | "loading" | "success" | "already" | "error"

export function SubscribeForm({ listName, listTitle, listDescription }: Props) {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!value) {
      setStatus("error")
      setErrorMsg("Enter your email address.")
      return
    }
    setStatus("loading")
    setErrorMsg("")

    try {
      const res = await apiFetch(`/api/subscribe/${encodeURIComponent(listName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        setStatus("success")
      } else if (res.status === 409 && data.error === "already_subscribed") {
        setStatus("already")
      } else if (res.status === 400) {
        setStatus("error")
        setErrorMsg("That email address doesn't look right. Check it and try again.")
      } else if (res.status === 404) {
        setStatus("error")
        setErrorMsg("This sign-up link is no longer active.")
      } else {
        setStatus("error")
        setErrorMsg("Couldn't subscribe you right now. Try again in a minute.")
      }
    } catch {
      setStatus("error")
      setErrorMsg("Couldn't reach the server. Check your connection and try again.")
    }
  }

  const done = status === "success" || status === "already"

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-16 pt-10 sm:px-6 md:pt-20">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        {done ? (
          <div role="status" className="flex flex-col gap-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
              {status === "success" ? <CheckCircle2 aria-hidden="true" className="size-5" /> : <MailCheck aria-hidden="true" className="size-5" />}
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="font-display text-4xl leading-none tracking-wide text-foreground">
                {status === "success" ? "You're subscribed" : "Already subscribed"}
              </h1>
              <p className="text-sm text-fg-secondary">
                {status === "success" ? (
                  <>We&apos;ll send {listTitle} to <span className="font-medium text-foreground">{email.trim()}</span>.</>
                ) : (
                  <><span className="font-medium text-foreground">{email.trim()}</span> already gets {listTitle}. Nothing else to do.</>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/news">Read past issues</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/">Go home</Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-col gap-2">
              <h1 className="font-display text-4xl leading-none tracking-wide text-foreground">Stay in the loop</h1>
              <p className="text-sm text-fg-secondary">
                Subscribe to {listTitle}. {listDescription}
              </p>
            </div>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Field label="Email" error={status === "error" ? errorMsg : undefined}>
                <Input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value)
                    if (status === "error") setStatus("idle")
                  }}
                  disabled={status === "loading"}
                  required
                  className="h-11"
                />
              </Field>
              <Button type="submit" size="lg" loading={status === "loading"} className="w-full">
                {status === "loading" ? "Subscribing…" : "Subscribe"}
              </Button>
            </form>
          </>
        )}
      </div>
      <p className="mt-4 px-1 text-xs text-fg-muted">
        You can unsubscribe at any time from the link in any email we send.
      </p>
    </div>
  )
}
