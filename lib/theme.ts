"use client"

import { useSyncExternalStore } from "react"
import type { Theme } from "./theme-script"

export type { Theme }
import { THEME_COLORS, THEME_STORAGE_KEY } from "./theme-script"

function read(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

/** Current theme, kept in sync with the `dark` class on <html>. Server snapshot is the default (dark). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "dark")
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme])
  try {
    if (theme === "light") localStorage.setItem(THEME_STORAGE_KEY, "light")
    else localStorage.removeItem(THEME_STORAGE_KEY)
  } catch {}
}
