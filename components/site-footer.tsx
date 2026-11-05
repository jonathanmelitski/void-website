"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Logo } from "@/components/navbar-01"
import { useAuth } from "@/lib/use-auth"

const CONTACT_EMAIL = "void.ultimate@gmail.com"
const NEWSLETTER_HREF = "/subscribe/void-public"

const linkClass =
  "inline-flex min-h-10 items-center rounded-md text-fg-secondary transition-colors hover:text-foreground sm:min-h-0 sm:py-1"

/** Site-wide footer for public pages. Hidden inside Void Live, where screens are full-height tools. */
export function SiteFooter() {
  const pathname = usePathname() ?? "/"
  const { user } = useAuth()
  if (pathname.startsWith("/live")) return null

  return (
    <footer className="border-t border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
        <div className="flex flex-col gap-3">
          <Link href="/" className="flex w-fit items-center gap-2 rounded-md text-foreground">
            <span className="text-2xl">
              <Logo />
            </span>
            <span className="font-display pt-0.5 text-2xl leading-none tracking-wide">Void Ultimate</span>
          </Link>
          <p className="max-w-xs text-fg-muted">
            Men&apos;s ultimate at the University of Pennsylvania, since 1976.
          </p>
        </div>

        <nav aria-label="Team" className="flex flex-col gap-1">
          <h2 className="mb-1 font-semibold text-foreground">Team</h2>
          <Link href="/roster" className={linkClass}>Roster</Link>
          <Link href="/news" className={linkClass}>News</Link>
          <Link href="/donate" className={linkClass}>Donate</Link>
        </nav>

        <div className="flex flex-col gap-1">
          <h2 className="mb-1 font-semibold text-foreground">Stay in touch</h2>
          <Link href={NEWSLETTER_HREF} className={linkClass}>Get the newsletter</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className={`${linkClass} break-all`}>{CONTACT_EMAIL}</a>
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="mb-1 font-semibold text-foreground">Void Live</h2>
          {user ? (
            <>
              <Link href="/live" className={linkClass}>Scores and events</Link>
              <Link href="/live/me" className={linkClass}>My film</Link>
            </>
          ) : (
            <Link href="/live/login" className={linkClass}>Sign in</Link>
          )}
        </div>
      </div>
    </footer>
  )
}
