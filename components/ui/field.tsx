"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }

type FieldProps = {
  label: React.ReactNode
  /** Helper text under the control. */
  hint?: React.ReactNode
  /** Error message; marks the control aria-invalid. */
  error?: React.ReactNode
  className?: string
  id?: string
  /** Exactly one control (Input, Textarea, NativeSelect, SelectTrigger…); id/aria are wired onto it. */
  children: React.ReactElement<ControlProps>
}

/**
 * Label + control + hint + error with htmlFor / aria-describedby / aria-invalid wired.
 *   <Field label="Opponent" hint="As shown on the scoreboard"><Input /></Field>
 */
function Field({ label, hint, error, className, children, id: idProp }: FieldProps) {
  const autoId = React.useId()
  const id = idProp ?? children.props.id ?? autoId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy =
    [children.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium text-fg-secondary">
        {label}
      </Label>
      {React.cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true } : {}),
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export { Field }
