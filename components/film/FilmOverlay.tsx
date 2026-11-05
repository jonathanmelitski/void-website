"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

const HISTORY_KEY = "voidFilmOverlay"

interface FilmOverlayProps {
  /** Called once the overlay should go away (Back button, Esc, or browser Back) */
  onClose: () => void
  /** Header title, e.g. "vs PSU". Looked up from `gameId` when omitted. */
  title?: string
  /** Secondary header text, e.g. the event name */
  subtitle?: string
  gameId?: string
  children: React.ReactNode
}

function onHistoryEntry() {
  return typeof window !== "undefined" && !!(window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY]
}

/** True when Esc belongs to something inside the film view rather than to the overlay */
function escapeBelongsInside(root: HTMLElement | null) {
  if (!root) return false
  // Sub-editors (sync editor, point event editor in edit mode, pickers) handle Esc themselves
  if (root.querySelector("[data-film-esc-layer]")) return true
  // Esc in a text field leaves the field first, so a half-typed note is never thrown away
  const active = document.activeElement
  if (
    active && root.contains(active) &&
    (active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement ||
      (active instanceof HTMLInputElement && !["button", "checkbox", "radio", "range"].includes(active.type)))
  ) {
    (active as HTMLElement).blur()
    return true
  }
  return false
}

/**
 * Full-screen host for the film viewer. A real modal dialog: focus moves in and is trapped, returns to
 * the trigger on close, the page behind is inert and doesn't scroll, Esc closes (innermost layer first),
 * and the browser Back button closes the overlay instead of leaving the page.
 */
export function FilmOverlay({ onClose, title, subtitle, gameId, children }: FilmOverlayProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null)
  useEffect(() => {
    if (title || !gameId) return
    let cancelled = false
    fetch(`/api/games/${gameId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((g: { opponent?: string; round?: string } | null) => {
        if (!cancelled && g?.opponent) setFetchedTitle(`vs ${g.opponent}${g.round ? ` · ${g.round}` : ""}`)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [title, gameId])

  // Browser Back closes the overlay: open adds a same-URL history entry, popping it closes
  useEffect(() => {
    if (!onHistoryEntry()) {
      window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_KEY]: true }, "")
    }
    const onPop = () => { if (!onHistoryEntry()) onCloseRef.current() }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  const requestClose = useCallback(() => {
    if (onHistoryEntry()) window.history.back() // popstate → onClose
    else onCloseRef.current()
  }, [])

  const heading = title ?? fetchedTitle ?? "Game film"

  return (
    <DialogPrimitive.Root open onOpenChange={open => { if (!open) requestClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          onEscapeKeyDown={e => { if (escapeBelongsInside(contentRef.current)) e.preventDefault() }}
          // Toasts, tooltips and nested dialogs live outside this subtree; never close on them
          onInteractOutside={e => e.preventDefault()}
          className="fixed inset-0 z-50 flex h-dvh flex-col bg-background text-left text-foreground"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5 sm:px-4">
            <Button variant="ghost" size="sm" onClick={requestClose} className="h-10 gap-1 sm:h-8">
              <ChevronLeft className="size-4" aria-hidden />
              Back
            </Button>
            <div className="flex min-w-0 items-baseline gap-2">
              <DialogPrimitive.Title className="truncate text-sm font-semibold">{heading}</DialogPrimitive.Title>
              {subtitle && <span className="hidden truncate text-xs text-fg-muted sm:inline">{subtitle}</span>}
            </div>
          </header>
          <div data-film-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 lg:overflow-hidden">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
