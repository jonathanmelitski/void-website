// Multi-angle film alignment (client-safe, pure).
//
// The main track (clips without a trackId) defines game film time: its clips laid end to end.
// Each angle clip carries sync/desync points that map stretches of its footage onto main time:
//   - desync points (and clip edges) split a clip into segments;
//   - within a segment, each sync point sets offset = mainMs − clipMs from its position forward,
//     and the segment's first sync also covers the segment's start;
//   - a segment with no sync point has no coverage (the angle shows "no footage" there).

export const MAIN_TRACK_ID = "main"

export type FilmSyncPoint =
  | { id: string; kind: "sync"; clipMs: number; mainClipId: string; mainClipMs: number }
  | { id: string; kind: "desync"; clipMs: number }

export type FilmTrack = { id: string; name: string }

type ClipLike = { id: string; trackId?: string; sortOrder?: number; createdAt: string; syncPoints?: FilmSyncPoint[] }

export function trackIdOf(clip: { trackId?: string }) {
  return clip.trackId || MAIN_TRACK_ID
}

export function sortClips<T extends ClipLike>(clips: T[]): T[] {
  return [...clips].sort((a, b) => {
    if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder
    if (a.sortOrder !== undefined) return -1
    if (b.sortOrder !== undefined) return 1
    return a.createdAt.localeCompare(b.createdAt)
  })
}

// ─── Main timeline ───────────────────────────────────────────────────────────

export type MainTimeline = {
  clipIds: string[]
  offsetsMs: number[]
  durationsMs: number[]
  totalMs: number
}

export function buildMainTimeline(clipIds: string[], durationsMs: number[]): MainTimeline {
  const offsetsMs: number[] = []
  let acc = 0
  for (const d of durationsMs) { offsetsMs.push(acc); acc += d }
  return { clipIds, offsetsMs, durationsMs, totalMs: acc }
}

/** Main film time of a (main clip, ms) anchor, or null if the clip isn't on the main track */
export function mainMsOf(timeline: MainTimeline, clipId: string, clipMs: number): number | null {
  const idx = timeline.clipIds.indexOf(clipId)
  return idx === -1 ? null : timeline.offsetsMs[idx] + clipMs
}

/** The main clip + clip-local ms at a main film time (clamped into the last clip) */
export function locateMain(timeline: MainTimeline, mainMs: number): { idx: number; clipId: string; clipMs: number } | null {
  const n = timeline.clipIds.length
  if (n === 0) return null
  let remaining = Math.max(0, mainMs)
  for (let i = 0; i < n; i++) {
    const d = timeline.durationsMs[i]
    if (remaining < d || i === n - 1) return { idx: i, clipId: timeline.clipIds[i], clipMs: remaining }
    remaining -= d
  }
  return null
}

// ─── Angle coverage ──────────────────────────────────────────────────────────

export type CoverageSpan = {
  clipId: string
  clipStartMs: number
  clipEndMs: number      // exclusive; Infinity when the clip's duration is unknown
  offsetMs: number       // mainMs = clipMs + offsetMs
  mainStartMs: number
  mainEndMs: number
}

/**
 * Where an angle's footage lands on main time. `durationMsOf` returns a clip's length when known.
 * Spans are returned sorted by main start time.
 */
export function buildAngleCoverage(
  angleClips: ClipLike[],
  main: MainTimeline,
  durationMsOf: (clipId: string) => number | undefined
): CoverageSpan[] {
  const spans: CoverageSpan[] = []
  for (const clip of angleClips) {
    const duration = durationMsOf(clip.id)
    const end = duration && duration > 0 ? duration : Infinity
    const points = [...(clip.syncPoints ?? [])]
      .filter(p => p.clipMs >= 0 && p.clipMs < end)
      .sort((a, b) => a.clipMs - b.clipMs || (a.kind === "desync" ? -1 : 1))

    const bounds = [0, ...points.filter(p => p.kind === "desync").map(p => p.clipMs), end]
    for (let b = 0; b < bounds.length - 1; b++) {
      const segStart = bounds[b]
      const segEnd = bounds[b + 1]
      if (segEnd <= segStart) continue
      const syncs = points
        .filter((p): p is Extract<FilmSyncPoint, { kind: "sync" }> => p.kind === "sync" && p.clipMs >= segStart && p.clipMs < segEnd)
        .map(p => ({ clipMs: p.clipMs, mainMs: mainMsOf(main, p.mainClipId, p.mainClipMs) }))
        .filter((p): p is { clipMs: number; mainMs: number } => p.mainMs !== null)
      for (let i = 0; i < syncs.length; i++) {
        const offsetMs = syncs[i].mainMs - syncs[i].clipMs
        const clipStartMs = i === 0 ? segStart : syncs[i].clipMs
        const clipEndMs = i + 1 < syncs.length ? syncs[i + 1].clipMs : segEnd
        if (clipEndMs <= clipStartMs) continue
        spans.push({
          clipId: clip.id, clipStartMs, clipEndMs, offsetMs,
          mainStartMs: clipStartMs + offsetMs, mainEndMs: clipEndMs + offsetMs,
        })
      }
    }
  }
  return spans.sort((a, b) => a.mainStartMs - b.mainStartMs)
}

/** The angle footage showing a main film moment; prefers `preferClipId` when spans overlap */
export function mainToAngle(
  mainMs: number,
  coverage: CoverageSpan[],
  preferClipId?: string
): { clipId: string; clipMs: number } | null {
  let hit: CoverageSpan | null = null
  for (const span of coverage) {
    if (mainMs >= span.mainStartMs && mainMs < span.mainEndMs) {
      if (!hit || span.clipId === preferClipId) hit = span
      if (span.clipId === preferClipId) break
    }
  }
  return hit ? { clipId: hit.clipId, clipMs: mainMs - hit.offsetMs } : null
}

/** Main film time of a moment in angle footage, or null where that footage isn't synced */
export function angleToMain(clipId: string, clipMs: number, coverage: CoverageSpan[]): number | null {
  for (const span of coverage) {
    if (span.clipId === clipId && clipMs >= span.clipStartMs && clipMs < span.clipEndMs) return clipMs + span.offsetMs
  }
  return null
}

/** First coverage span starting after a main film time */
export function nextCoverage(mainMs: number, coverage: CoverageSpan[]): CoverageSpan | null {
  return coverage.find(s => s.mainStartMs > mainMs) ?? null
}
