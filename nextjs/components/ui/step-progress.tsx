"use client"

import type { StepDef } from "@/lib/step-types"

export type { StepDef }

export function StepProgress({ steps }: { steps: StepDef[] }) {
  if (steps.length === 0) return null
  return (
    <div className="flex flex-col gap-2 py-1">
      {steps.map(step => (
        <div key={step.id} className="flex items-start gap-3 text-sm">
          <span className="mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center">
            {step.status === "done" && (
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-green-400">
                <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {step.status === "running" && (
              <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin inline-block" />
            )}
            {step.status === "error" && (
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-red-400">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {step.status === "pending" && (
              <span className="w-3.5 h-3.5 rounded-full border border-white/20 inline-block" />
            )}
          </span>
          <span
            className={
              step.status === "done"
                ? "text-white/40"
                : step.status === "running"
                ? "text-white"
                : step.status === "error"
                ? "text-red-400"
                : "text-white/25"
            }
          >
            {step.label}
            {step.error && (
              <span className="block text-xs text-red-400/80 mt-0.5">{step.error}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
