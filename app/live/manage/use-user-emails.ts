"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-fetch"

/**
 * Resolves account IDs (Cognito usernames, as stored in audit rows, sends and player links)
 * to emails using the existing admin users list. Admin-only endpoint: pass `enabled = false`
 * for other roles. Unknown IDs resolve to undefined so callers can fall back.
 */
export function useUserEmails(enabled = true) {
  const [emails, setEmails] = useState<Map<string, string> | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiFetch("/api/admin/users")
      .then(r => (r.ok ? r.json() : []))
      .then((users: unknown) => {
        if (cancelled) return
        const map = new Map<string, string>()
        if (Array.isArray(users)) {
          for (const u of users as { username?: string; email?: string }[]) {
            if (u.username && u.email) map.set(u.username, u.email)
          }
        }
        setEmails(map)
      })
      .catch(() => { if (!cancelled) setEmails(new Map()) })
    return () => { cancelled = true }
  }, [enabled])

  const emailFor = useCallback((id: string | undefined | null) => (id ? emails?.get(id) : undefined), [emails])
  /** True once the lookup finished (or failed), so callers can tell "loading" from "unknown". */
  const loaded = emails !== null
  return { emailFor, loaded }
}
