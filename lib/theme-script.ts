export type Theme = "dark" | "light"

export const THEME_STORAGE_KEY = "theme"
export const THEME_COLORS: Record<Theme, string> = { dark: "#0a0a0a", light: "#fafafa" }

/**
 * Runs in <head> before paint. The server renders `<html class="dark">`; this only drops the
 * class for visitors who picked light, so there's no flash either way.
 */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="light"){document.documentElement.classList.remove("dark");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","${THEME_COLORS.light}")}}catch(e){}`
