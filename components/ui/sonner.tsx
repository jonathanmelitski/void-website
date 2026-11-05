"use client"

import { Toaster as Sonner, toast, type ToasterProps } from "sonner"

/**
 * Mounted once in RootShell. Call `toast.success("Saved")`, `toast.error("Couldn't save. Try again.")`
 * or `toast("Link copied")` from anywhere: import { toast } from "@/components/ui/sonner".
 * Follows the OS theme like the rest of the app.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="bottom-center"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!bg-card !text-card-foreground !border-border !rounded-xl !shadow-lg !font-sans",
          description: "!text-fg-muted",
          actionButton: "!bg-foreground !text-background !rounded-md",
          cancelButton: "!bg-surface-2 !text-foreground !rounded-md",
          closeButton: "!bg-card !text-fg-muted !border-border hover:!text-foreground",
          error: "[&_[data-icon]]:!text-destructive",
          success: "[&_[data-icon]]:!text-success",
          warning: "[&_[data-icon]]:!text-warning",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
