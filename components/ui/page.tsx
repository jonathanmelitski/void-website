import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Page width + gutters. 16px gutters on phones, 24px on tablets, 32px on desktop.
 *   default 1152px · wide 1280px · prose 768px · form 384px (auth screens)
 */
const pageContainerVariants = cva("mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 pb-16 md:pt-10", {
  variants: {
    width: {
      default: "max-w-6xl",
      wide: "max-w-7xl",
      prose: "max-w-3xl",
      form: "max-w-sm pt-12 md:pt-20",
    },
  },
  defaultVariants: { width: "default" },
})

function PageContainer({
  className,
  width,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof pageContainerVariants>) {
  return <div data-slot="page-container" className={cn(pageContainerVariants({ width }), className)} {...props} />
}

type PageHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** Back link or breadcrumb shown above the title. */
  eyebrow?: React.ReactNode
  /** Buttons on the right; wrap under the title on phones. */
  actions?: React.ReactNode
  /** "display" = large public hero title, "page" = standard (default). */
  size?: "page" | "display"
}

/** Page title row: Bebas title, optional description and actions. Renders the page's <h1>. */
function PageHeader({ title, description, eyebrow, actions, size = "page", className, ...props }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("mb-6 flex flex-col gap-3 md:mb-8", className)} {...props}>
      {eyebrow && <div className="text-sm text-fg-muted">{eyebrow}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h1
            className={cn(
              "font-display tracking-wide leading-none text-foreground",
              size === "display" ? "text-5xl md:text-7xl" : "text-4xl md:text-5xl"
            )}
          >
            {title}
          </h1>
          {description && <p className="max-w-2xl text-sm text-fg-muted md:text-base">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export { PageContainer, PageHeader, pageContainerVariants }
