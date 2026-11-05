// Cache-Control policy for read-only API GETs.
//
// - Anything a signed-in caller receives, or anything from a private event: `private, no-store`.
// - Anonymous responses to public data: a short browser-only cache with stale-while-revalidate, so
//   hover pre-warm fetches and back/forward navigation reuse the response. `private` (not `public`)
//   on purpose: these URLs also serve signed-in users, and a shared cache/CDN that doesn't key on
//   cookies could otherwise hand an anonymous (or stale) copy to a coach who just edited the data.
//   `Vary: Cookie` makes the browser refetch once the visitor signs in.
// Public pages get their CDN caching from ISR (`export const revalidate`) instead.
import type { NextRequest } from "next/server"
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/cookies"

export const NO_STORE_HEADERS: Record<string, string> = { "Cache-Control": "private, no-store" }

export function hasSessionCookie(request: NextRequest): boolean {
  return !!(request.cookies.get(ACCESS_COOKIE)?.value || request.cookies.get(REFRESH_COOKIE)?.value)
}

/** Headers for a GET whose body is public data. Signed-in callers and private data get no-store. */
export function publicReadHeaders(
  request: NextRequest,
  { maxAge = 30, swr = 300, isPrivateData = false }: { maxAge?: number; swr?: number; isPrivateData?: boolean } = {}
): Record<string, string> {
  if (isPrivateData || hasSessionCookie(request)) return NO_STORE_HEADERS
  return { "Cache-Control": `private, max-age=${maxAge}, stale-while-revalidate=${swr}`, Vary: "Cookie" }
}
