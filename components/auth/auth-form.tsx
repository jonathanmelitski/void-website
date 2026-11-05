"use client"

// Shared pieces for the sign-in screens (/live/login, register, confirm, reset-password, confirm-reset).

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AUTH_GENERIC_ERROR, AUTH_NETWORK_ERROR, type AuthErrorCode } from "@/lib/auth-errors"

/** Password field with a show/hide toggle. Forwards id/aria props (works inside <Field>). */
export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("h-10 pr-11", className)} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0.5 top-1/2 -translate-y-1/2 text-fg-muted"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  )
}

/** 6-digit code field: numeric keypad on phones, strips spaces/dashes from pasted codes. */
export function CodeInput({ value, onValueChange, className, ...props }: Omit<React.ComponentProps<"input">, "onChange" | "value" | "type"> & {
  value: string
  onValueChange: (v: string) => void
}) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]{6}"
      autoComplete="one-time-code"
      maxLength={12}
      value={value}
      onChange={e => onValueChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className={cn("h-12 text-center font-mono tabular-nums text-lg tracking-[0.4em]", className)}
    />
  )
}

/**
 * Error / notice line above the submit button. Always rendered (reserves one line) so a message
 * doesn't push the form around, and announced to screen readers.
 */
export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  return (
    <div className="min-h-5 text-sm">
      <p role="alert" className="text-destructive">{error}</p>
      {!error && <p role="status" className="text-fg-secondary">{notice}</p>}
    </div>
  )
}

export type AuthResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string; code?: AuthErrorCode }

/** POST to an /api/auth route. Never throws; failures come back as plain-language copy. */
export async function postAuth(url: string, body: unknown): Promise<AuthResult> {
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: AUTH_NETWORK_ERROR }
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) return { ok: true, data }
  return {
    ok: false,
    error: typeof data.error === "string" ? data.error : AUTH_GENERIC_ERROR,
    code: typeof data.code === "string" ? (data.code as AuthErrorCode) : undefined,
  }
}
