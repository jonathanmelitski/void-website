export type StepStatus = "pending" | "running" | "done" | "error"

export type StepDef = {
  id: string
  label: string
  status: StepStatus
  error?: string
}

export type StreamEvent =
  | { type: "init"; steps: StepDef[] }
  | { type: "step"; id: string; status: StepStatus; error?: string }
  | { type: "done" }
  | { type: "error"; message: string }
