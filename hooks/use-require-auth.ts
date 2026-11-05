"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/use-auth"
import type { AuthUser } from "@/lib/auth-context"

type Role = "ADMIN" | "COACH" | "USER"

/**
 * Page guard for signed-in pages.
 * - Redirects to /live/login?next=<this page> only when there is definitely no session.
 *   Never while offline or when the session ended mid-page (the in-place sign-in sheet handles that).
 * - With `roles`, a signed-in user outside those roles goes to `forbiddenHref`.
 *
 * `ready` is true when `user` is present and allowed; render the page then, a loading state otherwise.
 */
export function useRequireAuth(opts: { roles?: Role[]; forbiddenHref?: string } = {}): {
  user: AuthUser | null
  ready: boolean
  isLoading: boolean
} {
  const { roles, forbiddenHref = "/live" } = opts
  const { user, status, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const rolesKey = roles?.join(",") ?? ""

  const allowed = !!user && (!roles || roles.some((r) => user.groups.includes(r)))

  useEffect(() => {
    if (status === "anonymous") {
      // window.location (not useSearchParams) so pages don't need a Suspense boundary.
      const next = (pathname ?? "/live") + window.location.search
      router.replace(`/live/login?next=${encodeURIComponent(next)}`)
      return
    }
    if (status === "authenticated" && user && rolesKey) {
      const ok = rolesKey.split(",").some((r) => user.groups.includes(r))
      if (!ok) router.replace(forbiddenHref)
    }
  }, [status, user, rolesKey, forbiddenHref, pathname, router])

  return { user: allowed ? user : null, ready: allowed, isLoading }
}

/** Same-origin path check for ?next= values (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/live"): string {
  if (!next) return fallback
  // Must be an absolute path on this site: "/x", not "//host", "/\host" or "https://..."
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback
  try {
    const url = new URL(next, "http://localhost")
    if (url.origin !== "http://localhost") return fallback
    if (url.pathname.startsWith("/live/login")) return fallback
    return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
}
