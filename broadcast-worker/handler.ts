import {
  streamStart,
  streamStop,
  streamDestroyAll,
} from "../nextjs/lib/aws/broadcast-jobs"

type WorkerEvent =
  | { action: "start"; gameId: string }
  | { action: "stop" }
  | { action: "destroy-all" }

// No-op send — worker writes state to DynamoDB directly; client polls GET /api/broadcast.
const noop = () => {}

export const handler = async (event: WorkerEvent): Promise<void> => {
  console.log("[broadcast-worker] event:", JSON.stringify(event))
  switch (event.action) {
    case "start":
      console.log("[broadcast-worker] starting stream for gameId:", (event as { action: "start"; gameId: string }).gameId)
      await streamStart((event as { action: "start"; gameId: string }).gameId, noop)
      break
    case "stop":
      console.log("[broadcast-worker] stopping stream")
      await streamStop(noop)
      break
    case "destroy-all":
      console.log("[broadcast-worker] destroying all")
      await streamDestroyAll(noop)
      break
    default:
      console.log("[broadcast-worker] unknown action, event was:", JSON.stringify(event))
  }
  console.log("[broadcast-worker] done")
}
