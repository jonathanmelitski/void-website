import type { StepDef, StepStatus, StreamEvent } from "./step-types"

export async function readStream(
  response: Response,
  onSteps: (steps: StepDef[]) => void,
  onStep: (id: string, status: StepStatus, error?: string) => void,
): Promise<void> {
  if (!response.body) throw new Error("No response body")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split("\n\n")
    buf = parts.pop() ?? ""
    for (const part of parts) {
      const line = part.startsWith("data: ") ? part.slice(6) : part
      const trimmed = line.trim()
      if (!trimmed) continue
      let event: StreamEvent
      try {
        event = JSON.parse(trimmed) as StreamEvent
      } catch {
        continue
      }
      if (event.type === "init") onSteps(event.steps)
      else if (event.type === "step") onStep(event.id, event.status, event.error)
      else if (event.type === "error") throw new Error(event.message)
    }
  }
}
