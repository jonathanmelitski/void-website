"use client"

import { useEffect, useRef, useState } from "react"
import { createNoise3D } from "simplex-noise"
import { cn } from "@/lib/utils"

type VortexProps = {
  className?: string
  particleCount?: number
  rangeY?: number
  baseHue?: number
  baseSpeed?: number
  rangeSpeed?: number
  baseRadius?: number
  rangeRadius?: number
}

const PROPS = 9 // x, y, vx, vy, life, ttl, speed, radius, hue
const BASE_TTL = 300
const RANGE_TTL = 600
const RANGE_HUE = 100
const NOISE_STEPS = 3
const X_OFF = 0.00125
const Y_OFF = 0.00125
const Z_OFF = 0.0005
const TAU = 2 * Math.PI

function useMedia(query: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [query])
  return matches
}

/**
 * Site background. Fixed, behind everything, never interactive.
 * - Dark theme: simplex-noise particle vortex on black. One rAF loop, cancelled on unmount,
 *   paused while the tab is hidden; fewer particles on small screens.
 * - prefers-reduced-motion: a single static frame, no loop.
 * - Light theme: a calm static brand-tinted wash (no canvas).
 */
export function Vortex({
  className,
  particleCount = 50,
  rangeY = 1000,
  baseHue = 220,
  baseSpeed = 0,
  rangeSpeed = 0.1,
  baseRadius = 1,
  rangeRadius = 2,
}: VortexProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDark = useMedia("(prefers-color-scheme: dark)")
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)")

  useEffect(() => {
    if (!isDark) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const noise3D = createNoise3D()
    const count = window.innerWidth < 640 ? Math.ceil(particleCount / 2) : particleCount
    const len = count * PROPS
    let particles = new Float32Array(len)
    let tick = 0
    let centerY = 0
    let raf = 0
    let running = false

    const rand = (n: number) => n * Math.random()
    const randRange = (n: number) => n - rand(2 * n)
    const fadeInOut = (t: number, m: number) => {
      const hm = 0.5 * m
      return Math.abs(((t + hm) % m) - hm) / hm
    }
    const lerp = (a: number, b: number, s: number) => (1 - s) * a + s * b

    const initParticle = (i: number) => {
      particles.set(
        [
          rand(canvas.width),
          centerY + randRange(rangeY),
          0,
          0,
          0,
          BASE_TTL + rand(RANGE_TTL),
          baseSpeed + rand(rangeSpeed),
          baseRadius + rand(rangeRadius),
          baseHue + rand(RANGE_HUE),
        ],
        i
      )
    }

    const resize = () => {
      // DPR is capped at 1: the glow pass is blurry by design and full-res costs a lot on phones.
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      centerY = 0.5 * canvas.height
    }

    const step = (i: number, draw: boolean) => {
      const x = particles[i]
      const y = particles[i + 1]
      const n = noise3D(x * X_OFF, y * Y_OFF, tick * Z_OFF) * NOISE_STEPS * TAU
      const vx = lerp(particles[i + 2], Math.cos(n), 0.5)
      const vy = lerp(particles[i + 3], Math.sin(n), 0.5)
      const life = particles[i + 4]
      const ttl = particles[i + 5]
      const speed = particles[i + 6]
      const x2 = x + vx * speed
      const y2 = y + vy * speed
      if (draw) {
        ctx.lineCap = "round"
        ctx.lineWidth = particles[i + 7]
        ctx.strokeStyle = `hsla(${particles[i + 8]},100%,60%,${fadeInOut(life, ttl)})`
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }
      particles[i] = x2
      particles[i + 1] = y2
      particles[i + 2] = vx
      particles[i + 3] = vy
      particles[i + 4] = life + 1
      if (x > canvas.width || x < 0 || y > canvas.height || y < 0 || life + 1 > ttl) initParticle(i)
    }

    const frame = () => {
      tick++
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < len; i += PROPS) step(i, true)
      // glow
      ctx.save()
      ctx.globalCompositeOperation = "lighter"
      ctx.filter = "blur(8px) brightness(200%)"
      ctx.drawImage(canvas, 0, 0)
      ctx.filter = "blur(4px) brightness(200%)"
      ctx.drawImage(canvas, 0, 0)
      ctx.filter = "none"
      ctx.drawImage(canvas, 0, 0)
      ctx.restore()
    }

    const loop = () => {
      frame()
      raf = requestAnimationFrame(loop)
    }
    const start = () => {
      if (running || reducedMotion) return
      running = true
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    resize()
    particles = new Float32Array(len)
    for (let i = 0; i < len; i += PROPS) initParticle(i)

    if (reducedMotion) {
      // Advance the simulation off-screen so particles are mid-life, then paint once.
      for (let t = 0; t < 240; t++) {
        tick++
        for (let i = 0; i < len; i += PROPS) step(i, false)
      }
      frame()
    } else {
      start()
    }

    const onResize = () => {
      resize()
      if (reducedMotion) frame()
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    window.addEventListener("resize", onResize)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [isDark, reducedMotion, particleCount, rangeY, baseHue, baseSpeed, rangeSpeed, baseRadius, rangeRadius])

  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-0 -z-10", className)}>
      {/* Both are rendered and switched by CSS so there is no theme flash before hydration. */}
      <canvas ref={canvasRef} className="hidden h-full w-full bg-black dark:block" />
      <div className="h-full w-full bg-[radial-gradient(ellipse_80%_55%_at_50%_40%,color-mix(in_oklch,var(--brand)_10%,transparent),transparent_70%)] dark:hidden" />
    </div>
  )
}
