"use client"

import { useCallback, useState } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"

/**
 * Newsletter cover for /news. Fills its (explicitly sized) parent.
 *
 * `unoptimized`: covers are S3 originals that can be several MB; routing them through the Next
 * image optimizer trips its fixed 7s upstream timeout and turns into a 500. The browser loads
 * them directly instead (new uploads are downscaled client-side, see lib/image-prep.ts).
 * If the image fails anyway, a branded placeholder takes its place so the card/hero still reads.
 */
export function NewsletterCover({
  src,
  sizes,
  priority = false,
  className,
}: {
  src: string
  sizes: string
  priority?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  // An error that fires before hydration never reaches onError; catch it on mount.
  const checkBroken = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(true)
  }, [])

  if (failed) {
    return (
      <div
        aria-hidden
        className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand via-brand/50 to-black"
      >
        <span className="font-display text-6xl tracking-widest text-white/15 select-none">VOID</span>
      </div>
    )
  }

  return (
    <Image
      ref={checkBroken}
      src={src}
      alt=""
      fill
      unoptimized
      sizes={sizes}
      priority={priority}
      className={cn("object-cover object-center", className)}
      onError={() => setFailed(true)}
    />
  )
}
