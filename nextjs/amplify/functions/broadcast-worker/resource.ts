import { defineFunction } from "@aws-amplify/backend"

export const broadcastWorker = defineFunction({
  name: "broadcast-worker",
  entry: "./handler.ts",
  timeoutSeconds: 870, // 14.5 minutes — well within Lambda's 15-min max
  memoryMB: 512,
  // Env vars are injected via backend.ts CDK overrides (they're available as
  // Amplify environment variables during the pipeline-deploy build phase).
})
