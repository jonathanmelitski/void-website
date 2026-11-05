import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const spinnerVariants = cva(
  "inline-block shrink-0 animate-spin rounded-full border-2 border-fg-faint border-t-foreground motion-reduce:animate-[spin_1.5s_linear_infinite]",
  {
    variants: {
      size: {
        xs: "size-3 border-[1.5px]",
        sm: "size-4",
        md: "size-6",
        lg: "size-8",
      },
    },
    defaultVariants: { size: "md" },
  }
)

type SpinnerProps = Omit<React.ComponentProps<"span">, "children"> &
  VariantProps<typeof spinnerVariants> & {
    /** Accessible label. Pass null when the spinner is decorative (e.g. inside a busy button). */
    label?: string | null
  }

/** Loading indicator. Use instead of hand-rolled `border-2 … animate-spin` divs. */
function Spinner({ className, size, label = "Loading", ...props }: SpinnerProps) {
  return (
    <span
      data-slot="spinner"
      role={label ? "status" : undefined}
      aria-label={label ?? undefined}
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    />
  )
}

/** Centred spinner for a whole page or panel while its data loads. */
function PageSpinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex min-h-[50dvh] w-full items-center justify-center", className)}>
      <Spinner size="md" label={label} />
    </div>
  )
}

export { Spinner, PageSpinner, spinnerVariants }
