"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"

type Align = "left" | "center" | "right"

function AlignLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="3" y="9" width="12" height="2" rx="1" />
      <rect x="3" y="13" width="18" height="2" rx="1" />
      <rect x="3" y="17" width="12" height="2" rx="1" />
    </svg>
  )
}

function AlignCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="6" y="9" width="12" height="2" rx="1" />
      <rect x="3" y="13" width="18" height="2" rx="1" />
      <rect x="6" y="17" width="12" height="2" rx="1" />
    </svg>
  )
}

function AlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="9" y="9" width="12" height="2" rx="1" />
      <rect x="3" y="13" width="18" height="2" rx="1" />
      <rect x="9" y="17" width="12" height="2" rx="1" />
    </svg>
  )
}

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const { src, alt, title, width, align = "left" } = node.attrs as {
    src: string
    alt?: string
    title?: string
    width: string | null
    align: Align
  }

  const imgRef = useRef<HTMLImageElement>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const directionRef = useRef<1 | -1>(1)
  const [isResizing, setIsResizing] = useState(false)

  const startResize = useCallback((e: React.MouseEvent, dir: 1 | -1) => {
    e.preventDefault()
    e.stopPropagation()
    startXRef.current = e.clientX
    startWidthRef.current = imgRef.current?.offsetWidth ?? 300
    directionRef.current = dir
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const onMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX - startXRef.current) * directionRef.current
      const newWidth = Math.max(80, startWidthRef.current + dx)
      updateAttributes({ width: `${Math.round(newWidth)}px` })
    }

    const onMouseUp = () => setIsResizing(false)

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    return () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
  }, [isResizing, updateAttributes])

  const alignJustify =
    align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"

  const handleBase: React.CSSProperties = {
    position: "absolute",
    width: 10,
    height: 10,
    background: "white",
    border: "1.5px solid rgba(0,0,0,0.45)",
    borderRadius: 2,
    zIndex: 10,
  }

  return (
    <NodeViewWrapper
      contentEditable={false}
      style={{ userSelect: "none", display: "block" }}
    >
      <div style={{ display: "flex", justifyContent: alignJustify, margin: "1.25rem 0" }}>
        <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>

          {/* Floating toolbar — appears above on selection */}
          {selected && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 2,
                background: "rgba(12,12,12,0.92)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8,
                padding: "4px 6px",
                zIndex: 20,
                boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
                whiteSpace: "nowrap",
              }}
            >
              {(["left", "center", "right"] as Align[]).map((a) => (
                <button
                  key={a}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    updateAttributes({ align: a })
                  }}
                  title={`Align ${a}`}
                  style={{
                    padding: "3px 5px",
                    borderRadius: 4,
                    border: "none",
                    background: align === a ? "rgba(255,255,255,0.15)" : "transparent",
                    color: align === a ? "white" : "rgba(255,255,255,0.45)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    transition: "background 0.12s, color 0.12s",
                  }}
                >
                  {a === "left" ? <AlignLeftIcon /> : a === "center" ? <AlignCenterIcon /> : <AlignRightIcon />}
                </button>
              ))}

              {/* Divider */}
              <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)", margin: "0 3px" }} />

              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  updateAttributes({ width: null })
                }}
                title="Reset size"
                style={{
                  padding: "3px 7px",
                  borderRadius: 4,
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.45)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontFamily: "inherit",
                  lineHeight: 1,
                  transition: "color 0.12s",
                }}
              >
                Reset
              </button>
            </div>
          )}

          {/* The image */}
          <img
            ref={imgRef}
            src={src}
            alt={alt ?? ""}
            title={title}
            draggable={false}
            style={{
              width: width ?? "auto",
              maxWidth: "100%",
              display: "block",
              borderRadius: 6,
              outline: selected ? "2px solid rgba(99,130,255,0.75)" : "2px solid transparent",
              transition: "outline-color 0.15s",
              cursor: isResizing ? "ew-resize" : "default",
            }}
          />

          {/* Resize handles — 4 corners */}
          {selected && (
            <>
              <div onMouseDown={(e) => startResize(e, 1)}  style={{ ...handleBase, bottom: -5, right: -5, cursor: "se-resize" }} />
              <div onMouseDown={(e) => startResize(e, -1)} style={{ ...handleBase, bottom: -5, left: -5,  cursor: "sw-resize" }} />
              <div onMouseDown={(e) => startResize(e, 1)}  style={{ ...handleBase, top: -5,    right: -5, cursor: "ne-resize" }} />
              <div onMouseDown={(e) => startResize(e, -1)} style={{ ...handleBase, top: -5,    left: -5,  cursor: "nw-resize" }} />
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}
