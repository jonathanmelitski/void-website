"use client"

import { Button } from "@/components/ui/button"
import { DialogClose, DialogFooter } from "@/components/ui/dialog"

/** Shared footer for manage create/edit dialogs: right-aligned Cancel + primary submit. */
export function FormFooter({
  submitLabel,
  isSubmitting,
  disabled,
}: {
  /** Sentence-case verb + noun, e.g. "Create event". */
  submitLabel: string
  isSubmitting?: boolean
  disabled?: boolean
}) {
  return (
    <DialogFooter className="pt-2">
      <DialogClose asChild>
        <Button type="button" variant="ghost" disabled={isSubmitting}>
          Cancel
        </Button>
      </DialogClose>
      <Button type="submit" loading={isSubmitting} disabled={disabled}>
        {submitLabel}
      </Button>
    </DialogFooter>
  )
}
