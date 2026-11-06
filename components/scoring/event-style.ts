import {
  CircleSlash, Flag, Goal, Hand, Handshake, type LucideIcon, Repeat, Shield, Timer, Wind,
} from "lucide-react"
import type { PointEventType } from "@/lib/aws/point-events"

/**
 * Logger button look per event type: an icon and a tinted fill. Tones use the status tokens so they
 * work in light and dark (success = good for VOID, destructive = bad for VOID, warning = defence).
 */
export const EVENT_BUTTON: Partial<Record<PointEventType, { icon: LucideIcon; tone: string }>> = {
  GOAL:          { icon: Goal,          tone: "border-success/40 bg-success/15 text-success" },
  ASSIST:        { icon: Handshake,     tone: "border-brand/40 bg-brand/10 text-brand-text" },
  HOCKEY_ASSIST: { icon: Handshake,     tone: "border-brand/40 bg-brand/10 text-brand-text" },
  TURNOVER:      { icon: CircleSlash,   tone: "border-destructive/40 bg-destructive/15 text-destructive" },
  BLOCK:         { icon: Shield,        tone: "border-warning/40 bg-warning/15 text-warning" },
  OPP_TURNOVER:  { icon: Hand,          tone: "border-success/40 bg-success/10 text-success" },
  PULL:          { icon: Wind,          tone: "border-border-strong bg-surface-2 text-foreground" },
  TIMEOUT:       { icon: Timer,         tone: "border-border bg-surface text-fg-secondary" },
  SUBSTITUTION:  { icon: Repeat,        tone: "border-border bg-surface text-fg-secondary" },
}

export const FALLBACK_BUTTON = { icon: Flag, tone: "border-border bg-surface text-fg-secondary" }
