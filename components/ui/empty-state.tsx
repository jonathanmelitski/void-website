import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const emptyStateVariants = cva("flex flex-col items-center justify-center gap-3 text-center", {
  variants: {
    variant: {
      inline: "py-8 px-4",
      page: "py-24 px-4",
    },
  },
  defaultVariants: { variant: "inline" },
})

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof emptyStateVariants> & {
    icon?: React.ReactNode
    title: React.ReactNode
    description?: React.ReactNode
    /** Usually a <Button size="sm">: the next thing to do. */
    action?: React.ReactNode
  }

/** "Nothing here yet" + what to do next. */
function EmptyState({ icon, title, description, action, variant, className, ...props }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn(emptyStateVariants({ variant }), className)} {...props}>
      {icon && (
        <div className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-muted [&_svg:not([class*='size-'])]:size-5">
          {icon}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export { EmptyState }
