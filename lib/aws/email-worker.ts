import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"

// Feature flag: the worker path is used only when EMAIL_WORKER_FUNCTION_NAME is set (and the
// SendRecipients table is configured). Otherwise sends run inline in the request (stopgap).
export function emailWorkerEnabled(): boolean {
  return !!process.env.EMAIL_WORKER_FUNCTION_NAME && !!process.env.DYNAMO_SEND_RECIPIENTS_TABLE
}

const lambdaClient = new LambdaClient({
  region: process.env.VOID_REGION ?? "us-east-2",
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

/** Async invoke: returns as soon as Lambda has queued the event. */
export async function invokeEmailWorker(payload: { sendId: string; runId: string; dryRun?: boolean }): Promise<void> {
  await lambdaClient.send(new InvokeCommand({
    FunctionName: process.env.EMAIL_WORKER_FUNCTION_NAME!,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify(payload)),
  }))
}
