import * as React from "react"
import { cn } from "@/lib/utils"

/** Keyboard shortcut hint. Hidden on touch-only devices (no keyboard to press it with). */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "hidden min-w-5 items-center justify-center rounded-md border border-border-strong bg-surface px-1.5 font-mono text-[11px] leading-5 text-fg-secondary pointer-fine:inline-flex",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
