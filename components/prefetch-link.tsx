"use client"
import Link from "next/link"
import { useCallback } from "react"
import type { ComponentProps } from "react"

interface PrefetchLinkProps extends ComponentProps<typeof Link> {
  apiPrefetchUrls?: string[]
}

export function PrefetchLink({ apiPrefetchUrls, onMouseEnter, children, ...props }: PrefetchLinkProps) {
  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      apiPrefetchUrls?.forEach(url => fetch(url, { priority: "low" }).catch(() => {}))
      if (typeof onMouseEnter === "function") onMouseEnter(e)
    },
    [apiPrefetchUrls, onMouseEnter]
  )
  return (
    <Link {...props} onMouseEnter={handleMouseEnter}>
      {children}
    </Link>
  )
}
