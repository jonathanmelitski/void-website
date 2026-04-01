import { defineBackend } from "@aws-amplify/backend"
import { broadcastWorker } from "./functions/broadcast-worker/resource"

const backend = defineBackend({ broadcastWorker })

const workerFn = backend.broadcastWorker.resources.lambda

// Pass the Amplify environment variables into the worker Lambda.
// These are the same vars already set in the Amplify console for the SSR app.
// They're available as process.env.X during the backend CDK synth phase.
const envVars: Record<string, string> = {
  VOID_ACCESS_KEY_ID:     process.env.VOID_ACCESS_KEY_ID     ?? "",
  VOID_SECRET_ACCESS_KEY: process.env.VOID_SECRET_ACCESS_KEY ?? "",
  VOID_REGION:            process.env.VOID_REGION            ?? "",
  DYNAMO_BROADCAST_TABLE: process.env.DYNAMO_BROADCAST_TABLE ?? "",
  ROUTE53_HOSTED_ZONE_ID: process.env.ROUTE53_HOSTED_ZONE_ID ?? "",
  YOUTUBE_STREAM_KEY:     process.env.YOUTUBE_STREAM_KEY     ?? "",
}
for (const [key, value] of Object.entries(envVars)) {
  workerFn.addEnvironment(key, value)
}

// After the first deploy, find the Lambda function name in the AWS Lambda console
// (search for "broadcast-worker") and add it as an Amplify environment variable:
//   BROADCAST_WORKER_FUNCTION_NAME = <the function name>
// Then redeploy. The SSR route reads this var to know which Lambda to invoke.
