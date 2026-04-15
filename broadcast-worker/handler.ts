import {
  streamPrepare,
  streamGoLive,
  streamStart,
  streamStop,
  streamDestroyAll,
} from "../nextjs/lib/aws/broadcast-jobs"

type WorkerEvent =
  | { action: "prepare"; gameId: string }
  | { action: "go-live" }
  | { action: "start"; gameId: string }
  | { action: "stop" }
  | { action: "destroy-all" }

// No-op send — worker writes state to DynamoDB directly; client polls GET /api/broadcast.
const noop = () => {}

export const handler = async (event: WorkerEvent): Promise<void> => {
  console.log("[broadcast-worker] event:", JSON.stringify(event))
  switch (event.action) {
    case "prepare":
      await streamPrepare(event.gameId, noop)
      break
    case "go-live":
      await streamGoLive(noop)
      break
    case "start":
      await streamStart(event.gameId, noop)
      break
    case "stop":
      await streamStop(noop)
      break
    case "destroy-all":
      await streamDestroyAll(noop)
      break
    default:
      console.log("[broadcast-worker] unknown action, event was:", JSON.stringify(event))
  }
  console.log("[broadcast-worker] done")
}
