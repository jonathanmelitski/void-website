import {
  streamStart,
  streamStop,
  streamDestroyAll,
} from "../nextjs/lib/aws/live-server-jobs"

type WorkerEvent =
  | { action: "start" }
  | { action: "stop" }
  | { action: "destroy-all" }

// No-op send — worker writes state to DynamoDB directly; client polls GET /api/live-server.
const noop = () => {}

export const handler = async (event: WorkerEvent): Promise<void> => {
  switch (event.action) {
    case "start":
      await streamStart(noop)
      break
    case "stop":
      await streamStop(noop)
      break
    case "destroy-all":
      await streamDestroyAll(noop)
      break
  }
}
