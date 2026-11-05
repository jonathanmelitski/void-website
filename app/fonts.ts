import localFont from "next/font/local"

/** Bebas Neue: single-weight, caps-only display face. Use via the `font-display` utility. */
export const bebas = localFont({
  src: "../public/jersey/BebasNeue-Regular.ttf",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-bebas",
  fallback: ["Impact", "Arial Narrow", "sans-serif"],
  adjustFontFallback: "Arial",
})
