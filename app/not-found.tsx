import type { Metadata } from "next"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Page not found" }

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="font-mono text-sm text-fg-muted">404</p>
      <h1 className="font-display text-5xl leading-none tracking-wide">Out of bounds</h1>
      <p className="text-sm text-fg-muted">This page doesn&apos;t exist or has moved.</p>
      <div className="mt-2 flex gap-2">
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/live">Void Live</Link>
        </Button>
      </div>
    </div>
  )
}
