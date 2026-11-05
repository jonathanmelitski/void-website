"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="font-display text-5xl leading-none tracking-wide">Something went wrong</h1>
      <p className="text-sm text-fg-muted">This page couldn&apos;t load. Try again, or head back home.</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  )
}
