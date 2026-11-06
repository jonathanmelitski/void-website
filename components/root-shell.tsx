"use client"

import { usePathname } from "next/navigation"
import NavigationBar from "@/components/NavBar"
import { Vortex } from "@/components/vortex"
import { Toaster } from "@/components/ui/sonner"
import { SiteFooter } from "@/components/site-footer"
import { HapticsProvider } from "react-haptics"
import { HAPTIC_PATTERNS } from "@/lib/haptics"
import { TapHaptics } from "@/components/tap-haptics"

/**
 * App chrome: skip link, sticky navbar, <main> landmark, background, toasts.
 * The document is the scroll container (no inner scroller), and nothing here creates a
 * stacking context around page content, so page-level `fixed z-50` overlays sit above the nav.
 *
 * z-scale: page content (auto) < navbar z-40 < overlays/dialogs/sheets z-50 < toasts.
 *
 * Haptics: TapHaptics ticks on every button/link tap (Android; best-effort on iOS). The few
 * [data-haptic] elements also get react-haptics' iOS switch overlay; see lib/haptics.ts.
 *
 * Overlay routes (/live/scoreboard) get a bare transparent shell. The vortex is public-only;
 * /live/* uses the plain theme background.
 */
export function RootShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isOverlay = pathname.startsWith("/live/scoreboard")
  const isLive = pathname.startsWith("/live")
  // The scoring console is a full-screen tool with its own back button: no site navbar or footer.
  const isConsole = /^\/live\/manage\/games\/[^/]+\/?$/.test(pathname)

  if (isOverlay) {
    return <>{children}</>
  }

  return (
    <HapticsProvider patterns={HAPTIC_PATTERNS}>
      <TapHaptics />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>
      {!isLive && <Vortex particleCount={50} rangeY={1000} baseHue={220} baseSpeed={0} rangeSpeed={0.1} />}
      {!isConsole && <NavigationBar />}
      <main id="main" className={isConsole ? "min-h-dvh w-full" : "min-h-[calc(100dvh-4rem)] w-full"}>
        {children}
      </main>
      {!isConsole && <SiteFooter />}
      <Toaster />
    </HapticsProvider>
  )
}
