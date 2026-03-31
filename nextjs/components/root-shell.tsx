"use client"

import { usePathname } from "next/navigation"
import NavigationBar from "@/components/NavBar"
import { Vortex } from "@/components/vortex"

/**
 * Wraps the app chrome (navbar + Vortex background).
 * Overlay routes (e.g. /live/scoreboard) get a bare transparent shell instead.
 */
export function RootShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isOverlay = pathname.startsWith("/live/scoreboard")

  if (isOverlay) {
    // No navbar, no background — just the children on a transparent canvas
    return <>{children}</>
  }

  return (
    <div className="fixed w-full h-full">
      <Vortex
        backgroundColor="black"
        particleCount={50}
        rangeY={1000}
        baseHue={220}
        baseSpeed={0.0}
        rangeSpeed={0.1}
        containerClassName="w-full h-full"
        className="flex items-start justify-center w-full h-full pt-16"
      >
        <nav className="fixed top-0 z-10 w-full">
          <NavigationBar />
        </nav>
        <div className="relative text-center z-5 text-white h-full w-full">
          {children}
        </div>
      </Vortex>
    </div>
  )
}
