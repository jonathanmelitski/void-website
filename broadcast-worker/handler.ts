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
  switch (event.action) {
    case "start":
      await streamStart(event.gameId, noop)
      break
    case "stop":
      await streamStop(noop)
      break
    case "destroy-all":
      await streamDestroyAll(noop)
      break
  }
}
