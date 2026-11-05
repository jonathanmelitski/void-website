"use client"
import dynamic from "next/dynamic"
import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import type { Player } from "@/models/RosterModels"
import type { JerseySide } from "./Jersey3D"
import { fullName, hasNumber, initials, jerseyName } from "./roster-utils"

// three.js + r3f + drei (~265 KB gz) and the model load only after first paint, when the stage is
// on screen and the browser is idle. Until then (and for reduced motion / Save-Data / no WebGL)
// the stage shows a pre-rendered poster of the jersey back with the print as real text.
const Jersey3D = dynamic(() => import("./Jersey3D"), { ssr: false, loading: () => null })

function webglAvailable() {
  try {
    const c = document.createElement("canvas")
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    return !!gl
  } catch {
    return false
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const on = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return reduced
}

type Props = {
  /** Player shown in the text (updates instantly). */
  player: Player
  /** Player printed on the jersey (follows `player`, but settles before re-dressing during keyboard runs). */
  dressed: Player
  onStep: (delta: 1 | -1) => void
  canPrev: boolean
  canNext: boolean
}

export default function JerseyStage({ player, dressed, onStep, canPrev, canNext }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [inView, setInView] = useState(false)
  const [want3D, setWant3D] = useState(false)
  const [ready, setReady] = useState(false)
  const [side, setSide] = useState<JerseySide>("back")

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: "100px" })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (want3D || !inView || reducedMotion) return
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (conn?.saveData || !webglAvailable()) return
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300))
    const cic = window.cancelIdleCallback ?? window.clearTimeout
    const id = ric(() => setWant3D(true), { timeout: 2500 })
    return () => cic(id)
  }, [inView, reducedMotion, want3D])

  const showPoster = !ready
  const dressedNumber = hasNumber(dressed) ? String(dressed.number) : ""
  const ghost = hasNumber(player) ? String(player.number) : initials(player)
  const name = fullName(player)
  const announce = `${hasNumber(player) ? `Number ${player.number}, ` : ""}${name}${player.is_captain ? ", captain" : ""}`

  return (
    <section
      aria-label="Selected player"
      className={cn(
        "theme-dark relative isolate flex overflow-hidden rounded-xl border border-border bg-background",
        // mobile: a band pinned under the navbar; desktop: a tall sticky stage beside the list
        "sticky top-16 z-20 h-60 flex-row-reverse",
        "lg:top-24 lg:h-[calc(100svh-8rem)] lg:max-h-[860px] lg:min-h-[540px] lg:flex-col"
      )}
    >
      {/* Spotlight from above and a floor glow; the stage is a dark inset in both themes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 0%, color-mix(in oklch, var(--brand) 38%, transparent), transparent 70%), radial-gradient(45% 18% at 50% 92%, color-mix(in oklch, var(--brand) 22%, transparent), transparent 70%)",
        }}
      />

      {/* Jersey */}
      <div
        ref={stageRef}
        role="img"
        aria-label={`Jersey for ${name}${hasNumber(dressed) ? `, number ${dressed.number}` : ""}`}
        className="relative h-full w-[56%] shrink-0 lg:h-auto lg:w-full lg:flex-1"
      >
        {/* Ghost numeral behind the jersey */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span
            key={ghost}
            className="font-display leading-none tracking-wide text-transparent select-none text-[11rem] lg:text-[clamp(16rem,30vw,30rem)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500"
            style={{ WebkitTextStroke: "1.5px color-mix(in oklch, var(--foreground) 24%, transparent)" }}
          >
            {ghost}
          </span>
        </div>

        {/* Poster: same framing as the 3D camera (square, full height, centred) */}
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity duration-500",
            showPoster ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="relative aspect-square h-full max-w-none [container-type:size]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/jersey/poster-back.webp" alt="" width={720} height={720} fetchPriority="high" className="size-full select-none" draggable={false} />
            {/* Print positions measured from the 3D render (same camera), so the hand-off is seamless. */}
            <span
              className="absolute left-1/2 top-[22.4%] whitespace-nowrap font-display leading-none text-white/90"
              style={{
                fontSize: `min(10.5cqh, ${(80 / Math.max(1, jerseyName(dressed).length)).toFixed(2)}cqh)`,
                transform: "translate(-50%, -50%) scaleX(0.75)",
              }}
            >
              {jerseyName(dressed)}
            </span>
            <span
              className="absolute left-1/2 top-[46%] whitespace-nowrap font-display leading-none text-white/90"
              style={{ fontSize: "28cqh", transform: "translate(-50%, -50%)" }}
            >
              {dressedNumber}
            </span>
          </div>
        </div>

        {want3D && (
          <div className={cn("absolute inset-0 transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")}>
            <Jersey3D
              print={{ name: jerseyName(dressed), number: dressedNumber }}
              side={side}
              active={inView}
              reducedMotion={reducedMotion}
              onReady={() => setReady(true)}
            />
          </div>
        )}
      </div>

      {/* Detail */}
      <div className="relative flex min-w-0 flex-1 flex-col justify-end gap-3 p-4 lg:flex-none lg:flex-row lg:items-end lg:justify-between lg:p-8">
        <div
          key={player.id}
          className="min-w-0 lg:flex lg:items-end lg:gap-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
        >
          {hasNumber(player) && (
            <p className="font-display text-5xl leading-none tracking-wide text-foreground lg:text-9xl lg:leading-[0.8]">
              <span className="sr-only">Number </span>
              {player.number}
            </p>
          )}
          <div className="min-w-0">
            <h2 className="mt-1 font-display text-2xl leading-[0.95] tracking-wide text-foreground lg:mt-0 lg:text-5xl">
              <span className="block text-fg-secondary">{player.first_name}</span>
              <span className="block break-words">{player.last_name}</span>
            </h2>
            {player.is_captain && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-fg-secondary">
                <CaptainMark /> Captain
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 max-lg:absolute max-lg:left-3 max-lg:top-3">
          {ready && (
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={side === "front"}
              aria-label={side === "back" ? "Turn the jersey to the front" : "Turn the jersey to the back"}
              onClick={() => setSide(s => (s === "back" ? "front" : "back"))}
              className="text-fg-secondary"
            >
              <RotateCw />
            </Button>
          )}
          <div className="hidden items-center gap-1 lg:flex">
            <Button variant="ghost" size="icon" aria-label="Previous player" disabled={!canPrev} onClick={() => onStep(-1)} className="text-fg-secondary">
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next player" disabled={!canNext} onClick={() => onStep(1)} className="text-fg-secondary">
              <ChevronDown />
            </Button>
            <span className="ml-2 hidden items-center gap-1 text-xs text-fg-muted xl:inline-flex">
              <Kbd>↑</Kbd><Kbd>↓</Kbd> to browse
            </span>
          </div>
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic>
        {announce}
      </p>
    </section>
  )
}

/** A captain's armband "C". */
export function CaptainMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-full border border-brand-text/60 font-display text-[13px] leading-none text-brand-text",
        className
      )}
    >
      C
    </span>
  )
}
