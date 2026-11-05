import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Styled native <select>. Prefer it on mobile-heavy screens (OS picker).
 * `className` styles the wrapper (width etc.). Options take popover colours from globals.css,
 * so the OS-drawn list stays readable in both themes (Windows paints options with the
 * <select>'s text colour on its own background).
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative w-full", className)} data-slot="native-select-wrapper">
      <select
        data-slot="native-select"
        className="h-9 w-full appearance-none rounded-md border border-input bg-surface pl-3 pr-9 text-base text-foreground transition-[color,border-color] hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
      />
    </div>
  )
}

export { NativeSelect }
