import * as React from "react"
import { cn } from "@/lib/utils"

/** Placeholder block while content loads. Size it like the content it replaces to avoid layout shift. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

function SkeletonCard({ className, ...props }: React.ComponentProps<"div">) {
  return <Skeleton className={cn("aspect-[4/3] w-full rounded-xl", className)} {...props} />
}

function SkeletonRow({ className, ...props }: React.ComponentProps<"div">) {
  return <Skeleton className={cn("h-12 w-full rounded-xl", className)} {...props} />
}

export { Skeleton, SkeletonCard, SkeletonRow }
