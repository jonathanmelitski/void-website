"use client"

import { useCallback, useRef, useState } from "react"

/**
 * Drag-to-reorder for a vertical list, with pointer events (mouse, pen and touch) on a handle,
 * plus ArrowUp/ArrowDown on the focused handle. Items keep their keys, so focus survives moves.
 *
 *   const { order, dragId, itemRef, handleProps } = useDragReorder(ids, commit)
 *   order.map(id => <li ref={itemRef(id)}><button {...handleProps(id, name)} /></li>)
 */
export function useDragReorder(ids: string[], onCommit: (next: string[]) => void) {
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const items = useRef(new Map<string, HTMLElement>())
  const orderRef = useRef<string[]>(ids)

  const order = dragOrder ?? ids

  const itemRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) items.current.set(id, el)
      else items.current.delete(id)
    },
    []
  )

  const move = useCallback(
    (id: string, delta: number) => {
      const i = ids.indexOf(id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= ids.length) return
      const next = [...ids]
      next.splice(i, 1)
      next.splice(j, 0, id)
      onCommit(next)
    },
    [ids, onCommit]
  )

  const handleProps = (id: string, label: string) => ({
    type: "button" as const,
    "aria-label": `Reorder ${label}. Use the arrow keys to move it.`,
    style: { touchAction: "none" as const },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp") { e.preventDefault(); move(id, -1) }
      if (e.key === "ArrowDown") { e.preventDefault(); move(id, 1) }
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      orderRef.current = ids
      setDragOrder(ids)
      setDragId(id)

      const onMove = (ev: PointerEvent) => {
        // Target slot = how many other items' midpoints sit above the pointer
        const others = orderRef.current.filter((x) => x !== id)
        let slot = 0
        for (const other of others) {
          const rect = items.current.get(other)?.getBoundingClientRect()
          if (rect && ev.clientY > rect.top + rect.height / 2) slot++
        }
        const next = [...others]
        next.splice(slot, 0, id)
        if (next.join() !== orderRef.current.join()) {
          orderRef.current = next
          setDragOrder(next)
        }
      }
      const onEnd = () => {
        handle.removeEventListener("pointermove", onMove)
        handle.removeEventListener("pointerup", onEnd)
        handle.removeEventListener("pointercancel", onEnd)
        const next = orderRef.current
        setDragOrder(null)
        setDragId(null)
        if (next.join() !== ids.join()) onCommit(next)
      }
      handle.addEventListener("pointermove", onMove)
      handle.addEventListener("pointerup", onEnd)
      handle.addEventListener("pointercancel", onEnd)
    },
  })

  return { order, dragId, itemRef, handleProps }
}
