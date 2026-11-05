'use client'

import { useCallback, useState } from "react"
import Image from "next/image"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Dialog as DialogPrimitive } from "radix-ui"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import type { Photo } from "@/models/GalleryModels"

interface LightboxProps {
  photos: Photo[]
  initialIndex: number
  onClose: () => void
  /** Used in the dialog's accessible name, e.g. the event title. */
  title?: string
}

// Controls sit on a black scrim over photos, so literal white is intended here.
const controlClass =
  "flex size-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 disabled:opacity-40"

/**
 * Full-screen photo viewer on a Radix dialog: focus is trapped and returned to the photo that
 * opened it, Esc closes, ←/→ move between photos, and the counter is announced.
 */
export function Lightbox({ photos, initialIndex, onClose, title }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [direction, setDirection] = useState(1)
  const reduceMotion = useReducedMotion()
  const many = photos.length > 1

  const prev = useCallback(() => {
    setDirection(-1)
    setCurrentIndex(i => (i - 1 + photos.length) % photos.length)
  }, [photos.length])

  const next = useCallback(() => {
    setDirection(1)
    setCurrentIndex(i => (i + 1) % photos.length)
  }, [photos.length])

  const photo = photos[currentIndex]
  if (!photo) return null
  const offset = reduceMotion ? 0 : 80

  return (
    <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
          aria-describedby={undefined}
          onKeyDown={e => {
            if (!many) return
            if (e.key === "ArrowLeft") { e.preventDefault(); prev() }
            else if (e.key === "ArrowRight") { e.preventDefault(); next() }
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {title ? `${title} photos` : "Photos"}
          </DialogPrimitive.Title>

          {/* Top bar: counter + close */}
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4">
            <p aria-live="polite" className="rounded-full bg-white/10 px-3 py-1 text-sm backdrop-blur-sm">
              Photo {currentIndex + 1} of {photos.length}
            </p>
            <DialogPrimitive.Close className={controlClass} aria-label="Close photos">
              <X aria-hidden="true" className="size-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Image (click outside the photo closes) */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-3 sm:px-20"
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={currentIndex}
                className="relative flex max-h-full max-w-full items-center justify-center"
                initial={{ opacity: 0, x: direction * offset }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -offset }}
                transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
                drag={many ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -50) next()
                  else if (info.offset.x > 50) prev()
                }}
              >
                <Image
                  src={photo.url}
                  alt={photo.alt}
                  width={photo.width ?? 1200}
                  height={photo.height ?? 800}
                  className="max-h-[calc(100dvh-10rem)] w-auto select-none rounded-xl object-contain"
                  draggable={false}
                  priority
                />
              </motion.div>
            </AnimatePresence>

            {many && (
              <>
                <button type="button" onClick={prev} aria-label="Previous photo" className={`${controlClass} absolute left-4 top-1/2 hidden -translate-y-1/2 sm:flex`}>
                  <ChevronLeft aria-hidden="true" className="size-6" />
                </button>
                <button type="button" onClick={next} aria-label="Next photo" className={`${controlClass} absolute right-4 top-1/2 hidden -translate-y-1/2 sm:flex`}>
                  <ChevronRight aria-hidden="true" className="size-6" />
                </button>
              </>
            )}
          </div>

          {/* Phones: thumb-reachable prev/next bar */}
          {many && (
            <div className="flex items-center justify-between gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
              <button type="button" onClick={prev} aria-label="Previous photo" className={controlClass}>
                <ChevronLeft aria-hidden="true" className="size-6" />
              </button>
              <p className="text-xs text-white/70">Swipe or use the arrows</p>
              <button type="button" onClick={next} aria-label="Next photo" className={controlClass}>
                <ChevronRight aria-hidden="true" className="size-6" />
              </button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
