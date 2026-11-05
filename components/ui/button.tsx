import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

/**
 * Variants:
 * - default: high-contrast primary (one per screen)
 * - brand: Live primary CTA (Start game, Go live)
 * - secondary: filled neutral
 * - outline: bordered neutral
 * - ghost: icon buttons / toolbar actions
 * - quiet: inline text action ("Edit", "Cancel", "Show more"), no padding
 * - destructive: delete / remove
 * - link: inline brand link
 * Sizes: xs, sm, default, lg, touch (sideline, 48px), icon-xs, icon-sm, icon, icon-lg, icon-touch.
 * Icon-only buttons need an aria-label.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity] disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:bg-foreground/90",
        brand: "bg-brand text-brand-foreground hover:bg-brand/90",
        secondary: "bg-surface-2 text-foreground hover:bg-surface-3",
        outline: "border border-border-strong bg-transparent text-foreground hover:bg-surface-2",
        ghost: "text-fg-secondary hover:bg-surface-2 hover:text-foreground",
        quiet: "h-auto px-0 py-0 text-fg-muted hover:text-foreground has-[>svg]:px-0",
        destructive:
          "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "h-auto px-0 py-0 text-brand-text underline-offset-4 hover:underline has-[>svg]:px-0",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-7 gap-1 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        touch: "h-12 gap-2 px-5 text-base has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-5",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
        "icon-touch": "size-12 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    compoundVariants: [
      // quiet and link are inline text; size only sets the font size
      { variant: ["quiet", "link"], size: ["xs", "sm"], className: "h-auto px-0 text-xs" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Shows a spinner, sets aria-busy and disables the button. */
    loading?: boolean
  }

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <Spinner size="sm" className="border-current/25 border-t-current" aria-hidden label={null} />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
