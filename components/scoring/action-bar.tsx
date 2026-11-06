"use client"

import { cn } from "@/lib/utils"

/**
 * iOS can only tick from a real tap on a switch overlay, and an overlay over scrolling content
 * breaks scrolling, so the fixed bar is where those overlays live: `[data-haptic]` buttons inside it.
 *
 * The console's thumb-zone bar: fixed to the bottom of the viewport on every screen size, with the
 * frequent actions for the current state (48px+). The page reserves room for it (see ACTION_BAR_SPACE).
 */
export function ActionBar({ children, label, className }: { children: React.ReactNode; label: string; className?: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
    >
      <div className={cn("mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2 sm:px-8", className)}>
        {children}
      </div>
    </div>
  )
}

/** Bottom padding for the page while an ActionBar is showing. */
export const ACTION_BAR_SPACE = "pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
