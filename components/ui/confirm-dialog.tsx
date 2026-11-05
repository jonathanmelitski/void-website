"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  /** Names the action, e.g. "Delete track". */
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive (default) renders the confirm button in the destructive style. */
  destructive?: boolean
  isLoading?: boolean
  onConfirm: () => void
}

/** Replaces window.confirm(). Controlled: keep `open` in state and close it in onConfirm. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "Delete", cancelLabel = "Cancel",
  destructive = true, isLoading, onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-fg-muted">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} loading={isLoading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
