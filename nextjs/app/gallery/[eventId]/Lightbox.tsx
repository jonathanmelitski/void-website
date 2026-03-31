'use client'

import { useEffect, useState } from "react"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import type { Photo } from "@/models/GalleryModels"

interface LightboxProps {
  photos: Photo[]
  initialIndex: number
  onClose: () => void
}

export function Lightbox({ photos, initialIndex, onClose }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [direction, setDirection] = useState(1)

  const prev = () => {
    setDirection(-1)
    setCurrentIndex(i => (i - 1 + photos.length) % photos.length)
  }

  const next = () => {
    setDirection(1)
    setCurrentIndex(i => (i + 1) % photos.length)
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev()
      else if (e.key === "ArrowRight") next()
      else if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  const photo = photos[currentIndex]

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors z-10 p-2"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={24} />
        </button>

        {/* Prev button (desktop only) */}
        <button
          className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors z-10 p-2 items-center justify-center"
          onClick={e => { e.stopPropagation(); prev() }}
          aria-label="Previous photo"
        >
          <ChevronLeft size={36} />
        </button>

        {/* Next button (desktop only) */}
        <button
          className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors z-10 p-2 items-center justify-center"
          onClick={e => { e.stopPropagation(); next() }}
          aria-label="Next photo"
        >
          <ChevronRight size={36} />
        </button>

        {/* Image */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={currentIndex}
            className="relative max-w-[90vw] max-h-[85vh] w-full flex items-center justify-center"
            initial={{ opacity: 0, x: direction * 80 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -80 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -50) next()
              else if (info.offset.x > 50) prev()
            }}
            onClick={e => e.stopPropagation()}
          >
            <Image
              src={photo.url}
              alt={photo.alt}
              width={photo.width ?? 1200}
              height={photo.height ?? 800}
              className="object-contain max-h-[85vh] w-auto rounded-lg select-none"
              draggable={false}
              priority
            />
          </motion.div>
        </AnimatePresence>

        {/* Counter pill */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/20 backdrop-blur-sm text-white text-sm px-3 py-1 rounded-full">
          {currentIndex + 1} / {photos.length}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
