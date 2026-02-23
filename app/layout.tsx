import NavigationBar from "@/components/NavBar";
import type { Metadata } from "next"
import "./globals.css"
import { Vortex } from "@/components/vortex";
import { ThemeProvider } from "@/components/void-live-theme-provider";

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
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
        >
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
              {/* Your content floats above the vortex */}
              <nav className="fixed top-0 z-10 w-full">
                <NavigationBar />
              </nav>

              <div className="relative text-center z-5 text-white h-full w-full">
                {children}
              </div>
            </Vortex>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}