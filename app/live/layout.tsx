import type { Metadata } from "next"
import React from "react"

export const metadata: Metadata = { title: { template: "%s · Void Live", default: "Void Live" } }

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
