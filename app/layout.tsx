import type { Metadata, Viewport } from "next"
import "./globals.css"
import { bebas } from "./fonts"
import { AuthProvider } from "@/lib/auth-context"
import { RootShell } from "@/components/root-shell"

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://voidultimate.com"
const DESCRIPTION = "The men's ultimate frisbee team at the University of Pennsylvania."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { template: "%s · Void Ultimate", default: "Void Ultimate" },
  description: DESCRIPTION,
  openGraph: {
    siteName: "Void Ultimate",
    title: "Void Ultimate",
    description: DESCRIPTION,
    type: "website",
    images: [{ url: "/void-team.png", alt: "Void Ultimate team photo" }],
  },
  twitter: { card: "summary_large_image" },
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={bebas.variable}>
      <body>
        <AuthProvider>
          <RootShell>{children}</RootShell>
        </AuthProvider>
      </body>
    </html>
  )
}
