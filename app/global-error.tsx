"use client"

import Link from "next/link"
import "./globals.css"

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-3xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-fg-muted">Void Ultimate couldn&apos;t load. Try again in a moment.</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={reset}
              className="h-9 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90"
            >
              Try again
            </button>
            <Link href="/" className="inline-flex h-9 items-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface-2">
              Go home
            </Link>
          </div>
        </main>
      </body>
    </html>
  )
}
