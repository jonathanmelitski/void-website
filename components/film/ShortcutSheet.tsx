"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Row = [keys: string[], description: string]

const PLAYBACK: Row[] = [
  [["Space", "K"], "Play / pause"],
  [["J", "L"], "Back / forward 5s"],
  [["←", "→"], "Back / forward 1s (hold ⇧ for 0.1s)"],
  [["[", "]"], "Previous / next tagged point"],
  [["1–9"], "Switch camera angle (1 is Main)"],
  [["V"], "Side-by-side angles"],
  [["?"], "Show these shortcuts"],
]

const TIMELINE: Row[] = [
  [["Tab", "⇧Tab"], "Step to the next / previous event"],
  [["=", "−", "\\"], "Zoom in / out / fit the point (⌘-scroll zooms at the cursor)"],
]

const EDITING: Row[] = [
  [["E"], "Edit events on / off"],
  [["P", "F", "T", "B", "A", "G"], "Add Pull · Pull finished · Turn · Block · Assist · Goal at the playhead"],
  [["S", "O"], "Add Sub · Timeout at the playhead"],
  [[",", "."], "Nudge the selection 0.1s (hold ⇧ for 1s)"],
  [["M"], "Move the selection to the playhead"],
  [["⇧M"], "Slide the whole point so the selected event (or Pull finished) lands on the playhead"],
  [["Enter"], "Change the player (or double-click the event)"],
  [["⇧L"], "Edit the line for this point"],
  [["⌫"], "Delete the selection"],
  [["⌘A", "Esc"], "Select all · clear the selection"],
  [["⌘Z", "⇧⌘Z"], "Undo / redo"],
  [["Alt"], "Hold while dragging to skip snapping"],
]

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-fg-secondary">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 text-xs">
        {rows.map(([keys, description]) => (
          <div key={description} className="contents">
            <dt className="flex flex-wrap gap-1">
              {keys.map(k => (
                <kbd key={k} className="inline-flex min-w-5 items-center justify-center rounded-md border border-border-strong bg-surface px-1.5 font-mono text-[11px] leading-5 text-fg-secondary">
                  {k}
                </kbd>
              ))}
            </dt>
            <dd className="text-fg-muted">{description}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Keyboard shortcuts for the film viewer, as a centered dialog that always fits on screen */
export function ShortcutSheet({ open, onOpenChange, canEdit }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Coaches/admins also see the point-event editing keys */
  canEdit: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            Shortcuts pause while the YouTube player has focus. Click anywhere outside the video to get them back.
          </DialogDescription>
        </DialogHeader>
        <Section title="Playback" rows={PLAYBACK} />
        <Section title="Point timeline" rows={TIMELINE} />
        {canEdit && <Section title="Editing (coaches)" rows={EDITING} />}
      </DialogContent>
    </Dialog>
  )
}
