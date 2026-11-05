"use client"

import { createContext, useContext } from "react"
import type { useUserEmails } from "./use-user-emails"

type Lookup = ReturnType<typeof useUserEmails>

export const UserEmailsContext = createContext<Lookup>({ emailFor: () => undefined, loaded: true })

/** Shows an account as its email; the raw account ID stays available on hover. */
export function PersonName({ id, lookup }: { id: string | undefined; lookup?: Lookup }) {
  const ctx = useContext(UserEmailsContext)
  const { emailFor, loaded } = lookup ?? ctx
  if (!id) return <span className="text-fg-muted">Unknown user</span>
  if (id === "you") return <span>you</span>
  const email = emailFor(id)
  if (email) return <span title={id}>{email}</span>
  if (!loaded) return <span className="text-fg-muted">…</span>
  return <span title={id} className="text-fg-muted">Unknown user</span>
}
