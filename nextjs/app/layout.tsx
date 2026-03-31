import type { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from "@/components/void-live-theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import { RootShell } from "@/components/root-shell";

export const metadata: Metadata = {
  title: "Void Ultimate",
  description: "The Men's Ultimate Frisbee team at the University of Pennsylvania",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <ThemeProvider attribute="class" defaultTheme="dark">
            <RootShell>{children}</RootShell>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}