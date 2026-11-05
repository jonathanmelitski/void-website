"use client"

import { errorMessage } from "@/lib/api-fetch"
import { toast } from "@/components/ui/sonner"

export const CONNECTION_HINT = "Check your connection and try again."

/**
 * A user-facing message for a failed response. 4xx validation messages from our routes are
 * passed through; 5xx bodies can carry raw AWS text, so those get the fallback instead.
 */
export async function friendlyError(res: Response, fallback: string): Promise<string> {
  if (res.status >= 500) return fallback
  return errorMessage(res, fallback)
}

type Noun = { one: string; many: string }

/**
 * Runs one delete request per item and reports the outcome with a toast.
 * Returns only the items the server confirmed, so callers remove just those rows.
 */
export async function deleteMany<T>(
  items: T[],
  request: (item: T) => Promise<Response>,
  noun: Noun,
): Promise<T[]> {
  const results = await Promise.all(
    items.map(async item => {
      try {
        const res = await request(item)
        if (res.ok) return { item, reason: null }
        return { item, reason: await friendlyError(res, "") }
      } catch {
        return { item, reason: CONNECTION_HINT }
      }
    }),
  )

  const deleted = results.filter(r => r.reason === null).map(r => r.item)
  const failed = results.filter(r => r.reason !== null)
  const label = (n: number) => `${n} ${n === 1 ? noun.one : noun.many}`
  const reason = failed.find(r => r.reason)?.reason
  const reasonText = reason ? ` ${reason}` : " Try again."

  if (failed.length === 0) {
    toast.success(items.length === 1 ? `Deleted ${noun.one}` : `Deleted ${label(items.length)}`)
  } else if (deleted.length === 0) {
    toast.error(
      items.length === 1
        ? `Couldn't delete the ${noun.one}.${reasonText}`
        : `Couldn't delete ${label(items.length)}.${reasonText}`,
    )
  } else {
    toast.error(`Deleted ${deleted.length} of ${label(items.length)}. ${failed.length} failed.${reasonText}`)
  }

  return deleted
}
