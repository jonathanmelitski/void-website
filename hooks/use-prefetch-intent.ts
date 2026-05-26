"use client"
import { useRouter } from "next/navigation"
import { useCallback } from "react"

export function usePrefetchIntent(href: string) {
  const router = useRouter()
  const handleMouseEnter = useCallback(() => router.prefetch(href), [router, href])
  return { onMouseEnter: handleMouseEnter }
}
