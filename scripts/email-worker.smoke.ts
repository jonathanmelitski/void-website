// Post-deploy smoke test for the void-email-worker Lambda (run by deploy-email-worker.yml).
//
//   npx tsx scripts/email-worker.smoke.ts
//
// Invokes the deployed function synchronously with an *ephemeral dry run* over the SES simulator
// list: no send record, no SES SendEmail (the handler never builds a sender for a dry run). It proves
// the bundle loads, the role can read SES contacts and write the recipients table, and the job loop
// finishes. Then it deletes the dryrun-* rows it created. Uses ambient AWS credentials, us-east-2.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb"
import { NodeHttpHandler } from "@smithy/node-http-handler"
import { SIM_TOPIC } from "../email-worker/core"

const REGION = "us-east-2"
const FUNCTION = process.env.EMAIL_WORKER_FUNCTION_NAME ?? "void-email-worker"
const RECIPIENTS = process.env.DYNAMO_SEND_RECIPIENTS_TABLE ?? "VoidEmailSendRecipients"
/** The simulator list holds 1000; a few may be opted out by bounce/complaint handling. */
const MIN_RECIPIENTS = Number(process.env.SMOKE_MIN_RECIPIENTS ?? 900)

const lambda = new LambdaClient({ region: REGION, requestHandler: new NodeHttpHandler({ requestTimeout: 900_000 }) })
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

export async function recipientRows(sendId: string) {
  const rows: { email: string; status: string; messageId?: string }[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: RECIPIENTS, KeyConditionExpression: "sendId = :id",
      ExpressionAttributeValues: { ":id": sendId }, ExclusiveStartKey,
    }))
    rows.push(...((res.Items ?? []) as typeof rows))
    ExclusiveStartKey = res.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return rows
}

export async function deleteRecipientRows(sendId: string) {
  const rows = await recipientRows(sendId)
  for (let i = 0; i < rows.length; i += 25) {
    let items: Record<string, unknown>[] | undefined = rows.slice(i, i + 25).map(r => ({ DeleteRequest: { Key: { sendId, email: r.email } } }))
    for (let attempt = 0; items?.length && attempt < 6; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 100 * 2 ** attempt))
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [RECIPIENTS]: items as never } }))
      items = res.UnprocessedItems?.[RECIPIENTS] as Record<string, unknown>[] | undefined
    }
    if (items?.length) throw new Error(`couldn't delete ${items.length} rows for ${sendId}`)
  }
  return rows.length
}

async function main() {
  const sendId = `dryrun-smoke-${randomUUID()}`
  const started = Date.now()
  console.log(`invoking ${FUNCTION}: ephemeral dry run over ${SIM_TOPIC} (${sendId})`)
  try {
    const res = await lambda.send(new InvokeCommand({
      FunctionName: FUNCTION,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({ sendId, runId: "smoke", dryRun: true, ephemeral: { listName: SIM_TOPIC } })),
    }))
    const body = res.Payload ? Buffer.from(res.Payload).toString() : ""
    assert.ok(!res.FunctionError, `function error (${res.FunctionError}): ${body}`)
    const out = JSON.parse(body) as { outcome: string; sent: number; failed: number }
    console.log(`result after ${Math.round((Date.now() - started) / 1000)} s: ${body}`)

    assert.equal(out.outcome, "complete", "the dry run should finish in one invocation")
    assert.equal(out.failed, 0)
    assert.ok(out.sent >= MIN_RECIPIENTS, `expected at least ${MIN_RECIPIENTS} recipients, got ${out.sent}`)

    const rows = await recipientRows(sendId)
    assert.equal(rows.length, out.sent, "one row per recipient")
    assert.ok(rows.every(r => r.status === "DRYRUN"), "every row ends DRYRUN")
    assert.ok(rows.every(r => !r.messageId), "a dry run never has an SES message id")
    assert.ok(rows.every(r => r.email.endsWith("@simulator.amazonses.com")), "only simulator addresses")
    console.log(`✓ ${rows.length} rows, all DRYRUN, no message ids`)
  } finally {
    const n = await deleteRecipientRows(sendId)
    console.log(`cleaned up ${n} rows`)
  }
  console.log("email-worker smoke test passed")
}

if (process.argv[1]?.endsWith("email-worker.smoke.ts")) {
  main().catch(err => { console.error(err); process.exit(1) })
}
