"use client"
/**
 * The roster's one WebGL canvas: the hero jersey. Loaded lazily by JerseyStage (next/dynamic, ssr:false)
 * so three.js never sits on the critical path.
 *
 * - frameloop="demand": nothing renders unless something moves (spin, idle sway, drag).
 * - Re-dressing for a new player is a single 360° spin; the name/number texture is redrawn while the
 *   jersey is edge-on, so the change is never visible as a pop.
 * - One 1024² CanvasTexture is reused for every player.
 */
import { Suspense, useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useGLTF, useTexture, Center } from "@react-three/drei"
import * as THREE from "three"

const MODEL = "/jersey/updated_shirt.glb"
const BASE_TEXTURE = "/jersey/void skyline 2.png"
const TEX = 1024
const TAU = Math.PI * 2

export type JerseyPrint = { name: string; number: string }
export type JerseySide = "back" | "front"

type Props = {
  print: JerseyPrint
  side: JerseySide
  /** Stage is on screen; idle sway only runs while visible. */
  active: boolean
  reducedMotion: boolean
  onReady?: () => void
}

type Motion = {
  angle: number
  tween: { from: number; to: number; start: number; dur: number; swapAt?: number; onDone?: () => void } | null
  swayStart: number | null
  dragging: boolean
  shown: string
  pending: JerseyPrint | null
}

const restAngle = (side: JerseySide) => (side === "back" ? Math.PI : 0)
/** The rest angle equivalent (rest + 2πk) closest to `angle`. */
const nearestRest = (angle: number, side: JerseySide) => {
  const r = restAngle(side)
  return r + Math.round((angle - r) / TAU) * TAU
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const printKey = (p: JerseyPrint) => `${p.number}|${p.name}`

function fontFamily() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-bebas").trim()
  return v || "Impact, sans-serif"
}

function drawPrint(ctx: CanvasRenderingContext2D, base: CanvasImageSource, print: JerseyPrint, family: string) {
  const s = TEX / 2048
  ctx.clearRect(0, 0, TEX, TEX)
  ctx.drawImage(base, 0, 0, TEX, TEX)
  const box = (text: string, x1: number, y1: number, x2: number, y2: number, rot: number, condense = 1) => {
    if (!text) return
    const w = (x2 - x1) * s, h = (y2 - y1) * s
    ctx.save()
    ctx.translate(((x1 + x2) / 2) * s, ((y1 + y2) / 2) * s)
    ctx.rotate(rot)
    ctx.scale(condense, 1)
    let size = h / 0.75
    ctx.font = `${size}px ${family}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const tw = ctx.measureText(text).width
    if (tw > w / condense) {
      size *= w / condense / tw
      ctx.font = `${size}px ${family}`
    }
    ctx.fillStyle = "white"
    ctx.fillText(text, 0, 0)
    ctx.restore()
  }
  box(print.number, 120, 1450, 563, 1700, Math.PI) // back number (texture is upside down)
  box(print.number, 1014, 771, 1209, 945, 0) // chest number
  box(print.name, 109, 1815, 564, 1904, Math.PI, 0.75) // back name, condensed
}

function JerseyModel({ print, side, active, reducedMotion, onReady }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { nodes, materials } = useGLTF(MODEL) as any
  const base = useTexture(BASE_TEXTURE)
  const invalidate = useThree(s => s.invalidate)
  const group = useRef<THREE.Group>(null)

  const { ctx, texture } = useMemo(() => {
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = TEX
    const texture = new THREE.CanvasTexture(canvas)
    texture.flipY = false
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return { ctx: canvas.getContext("2d")!, texture }
  }, [])

  const material = useMemo(() => {
    const src = Object.values(materials ?? {})[0] as THREE.MeshStandardMaterial | undefined
    const mat = src ? src.clone() : new THREE.MeshStandardMaterial()
    mat.roughness = 1
    mat.metalness = 0
    mat.map = texture
    mat.needsUpdate = true
    return mat
  }, [materials, texture])

  useEffect(() => () => { texture.dispose(); material.dispose() }, [texture, material])

  const m = useRef<Motion>({ angle: restAngle(side), tween: null, swayStart: null, dragging: false, shown: "", pending: null })
  const family = useRef<string>("")
  const sideRef = useRef(side)
  const reducedRef = useRef(reducedMotion)
  const activeRef = useRef(active)
  const printRef = useRef(print)
  useEffect(() => {
    reducedRef.current = reducedMotion
    activeRef.current = active
    printRef.current = print
  })

  const paint = (p: JerseyPrint) => {
    drawPrint(ctx, base.image as CanvasImageSource, p, family.current)
    texture.needsUpdate = true
    m.current.shown = printKey(p)
  }

  // First dress: wait for Bebas so the canvas never paints the fallback face.
  useEffect(() => {
    let cancelled = false
    family.current = fontFamily()
    document.fonts.load(`100px ${family.current}`).catch(() => {}).finally(() => {
      if (cancelled) return
      paint(printRef.current)
      m.current.swayStart = reducedRef.current ? null : performance.now()
      invalidate()
      requestAnimationFrame(() => onReady?.())
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spinTo = (p: JerseyPrint) => {
    const s = m.current
    if (!s.shown) return // first paint not done yet; it will pick up the latest print
    if (reducedRef.current) { paint(p); invalidate(); return }
    s.pending = p
    if (s.tween || s.dragging) return // the frame loop starts another spin when this motion ends
    const baseAngle = nearestRest(s.angle, sideRef.current)
    s.swayStart = null
    s.tween = {
      from: s.angle, to: baseAngle + TAU, start: performance.now(), dur: 1100,
      swapAt: baseAngle + Math.PI / 2,
      onDone: () => { s.swayStart = performance.now() },
    }
    invalidate()
  }

  useEffect(() => {
    if (printKey(print) !== m.current.shown) spinTo(print)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [print.name, print.number])

  useEffect(() => {
    if (sideRef.current === side) return
    sideRef.current = side
    const s = m.current
    const target = s.angle + Math.PI
    if (reducedRef.current) { s.angle = nearestRest(target, side); invalidate(); return }
    s.swayStart = null
    s.tween = { from: s.angle, to: nearestRest(target, side), start: performance.now(), dur: 700, onDone: () => { s.swayStart = performance.now() } }
    invalidate()
  }, [side, invalidate])

  useEffect(() => { if (active) invalidate() }, [active, invalidate])

  // Drag-to-turn (horizontal only; the stage keeps `touch-action: pan-y` so the page still scrolls).
  const gl = useThree(s => s.gl)
  useEffect(() => {
    const el = gl.domElement
    let lastX = 0
    const down = (e: PointerEvent) => {
      const s = m.current
      if (s.tween) return
      s.dragging = true
      s.swayStart = null
      lastX = e.clientX
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const s = m.current
      if (!s.dragging) return
      s.angle += (e.clientX - lastX) * 0.012
      lastX = e.clientX
      invalidate()
    }
    const up = () => {
      const s = m.current
      if (!s.dragging) return
      s.dragging = false
      const to = nearestRest(s.angle, sideRef.current)
      s.tween = { from: s.angle, to, start: performance.now(), dur: reducedRef.current ? 1 : 600 }
      invalidate()
    }
    el.addEventListener("pointerdown", down)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
    return () => {
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
    }
  }, [gl, invalidate])

  useFrame(() => {
    const s = m.current
    const now = performance.now()
    let moving = false
    if (s.tween) {
      const t = s.tween
      const p = Math.min(1, (now - t.start) / t.dur)
      s.angle = t.from + (t.to - t.from) * easeInOut(p)
      if (t.swapAt !== undefined && s.angle >= t.swapAt && s.pending) {
        paint(s.pending)
        t.swapAt = undefined
        s.pending = null
      }
      if (p >= 1) {
        s.tween = null
        // Every tween ends on a rest pose; snap back to the base one so the angle never grows.
        s.angle = restAngle(sideRef.current)
        t.onDone?.()
        // A new player was picked mid-motion: one more spin to dress them.
        const next = s.pending
        s.pending = null
        if (next && printKey(next) !== s.shown) spinTo(next)
      }
      moving = true
    } else if (!s.dragging && s.swayStart !== null && !reducedRef.current && activeRef.current) {
      // A slow ±16° sway for 6 s after the jersey settles, then it holds still (and stops rendering).
      const t = (now - s.swayStart) / 6000
      const rest = nearestRest(s.angle, sideRef.current)
      if (t >= 1) { s.angle = rest; s.swayStart = null }
      else { s.angle = rest + 0.28 * Math.sin(t * TAU) * Math.sin(t * Math.PI); moving = true }
    }
    if (group.current) group.current.rotation.y = s.angle
    if (moving || s.dragging) invalidate()
  })

  return (
    <group ref={group} dispose={null}>
      <Center>
        <group>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {Object.entries(nodes).map(([name, node]: [string, any]) =>
            node.isMesh ? <mesh key={name} geometry={node.geometry} material={material} /> : null
          )}
        </group>
      </Center>
    </group>
  )
}

export default function Jersey3D(props: Props) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      // Framing must match the poster (/jersey/poster-back.webp, captured from this camera at 1:1).
      camera={{ position: [0, 0, 1.2], fov: 45 }}
      style={{ touchAction: "pan-y" }}
      aria-hidden
    >
      <ambientLight intensity={2.4} />
      <directionalLight position={[2, 4, 3]} intensity={1.1} />
      <directionalLight position={[-3, 1, -4]} intensity={0.9} color="#8b7bff" />
      <Suspense fallback={null}>
        <JerseyModel {...props} />
      </Suspense>
    </Canvas>
  )
}
