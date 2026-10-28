"use client"

import { useState } from "react"
import type { FilmAnnotationItem } from "@/lib/aws/film-annotations"
import type { PointItem } from "@/lib/aws/points"
import { authorLabel } from "@/lib/author-name"

interface AnnotationMarkerProps {
  annotation: FilmAnnotationItem
  durationMs: number
  onSeek: (timestampMs: number) => void
  pointData?: PointItem
}

const POINT_DOT_COLORS: Record<string, string> = {
  "O-HOLD": "bg-blue-500",
  "O-BREAK": "bg-orange-500",
  "D-HOLD": "bg-green-500",
  "D-BREAK": "bg-red-500",
}

export function AnnotationMarker({ annotation, durationMs, onSeek, pointData }: AnnotationMarkerProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const pct = durationMs > 0 ? (annotation.videoTimestampMs / durationMs) * 100 : 0

  const isPointMarker = !!pointData
  const dotColor = isPointMarker
    ? (POINT_DOT_COLORS[`${pointData.lineType}-${pointData.outcome}`] ?? "bg-white/50")
    : "bg-purple-400"

  const tooltipText = isPointMarker
    ? `Point ${pointData.pointNumber} · ${pointData.lineType}-line · ${pointData.voidScoreBefore}–${pointData.opponentScoreBefore}${annotation.text ? `\n${annotation.text}` : ""}`
    : annotation.text

  return (
    <button
      className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 border border-white/40 hover:scale-150 transition-transform z-10 focus:outline-none ${dotColor} ${isPointMarker ? "w-3 h-3 rounded-sm" : "w-2.5 h-2.5 rounded-full"}`}
      style={{ left: `${pct}%` }}
      onClick={e => { e.stopPropagation(); onSeek(annotation.videoTimestampMs) }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      title={tooltipText}
    >
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-black/90 border border-white/10 rounded-lg px-2 py-1.5 text-left pointer-events-none z-20">
          {isPointMarker && (
            <p className="text-[10px] font-mono text-white/50 mb-0.5">
              Point {pointData.pointNumber} · {pointData.lineType} · {pointData.voidScoreBefore}–{pointData.opponentScoreBefore}
            </p>
          )}
          {annotation.text && <p className="text-xs text-white/80 line-clamp-2">{annotation.text}</p>}
          {!isPointMarker && authorLabel(annotation.authorDisplayName) && (
            <p className="text-[10px] text-white/40 mt-0.5">{authorLabel(annotation.authorDisplayName)}</p>
          )}
        </div>
      )}
    </button>
  )
}
