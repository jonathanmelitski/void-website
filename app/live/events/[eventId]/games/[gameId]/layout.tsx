import type { Metadata } from "next"

// The page sets "Void vs <opponent>" once the game loads.
export const metadata: Metadata = { title: "Game" }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
