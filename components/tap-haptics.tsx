"use client"

import { useEffect } from "react"
import { useHaptics } from "react-haptics"

/**
 * App-wide tap haptics without per-element overlays: one capture-phase click listener on the
 * document. Buttons say which pattern via `data-tap-haptic` (Button sets it; "off" opts out); other
 * buttons and links get "selection". Elements with `data-haptic` are skipped: their iOS overlay
 * already ticks. Android only in practice (see lib/haptics.ts).
 */
export function TapHaptics() {
  const { trigger } = useHaptics()
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!e.isTrusted) return // the iOS overlay re-dispatches a synthetic click on its host
      const el = (e.target as Element | null)?.closest<HTMLElement>("[data-tap-haptic], button, a[href], [role='button'], summary")
      if (!el || el.closest("[data-haptic]")) return
      if (el.matches(":disabled, [aria-disabled='true']")) return
      const pattern = el.dataset.tapHaptic ?? "selection"
      if (pattern !== "off") trigger(pattern)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [trigger])
  return null
}
