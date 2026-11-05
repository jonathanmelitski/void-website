import { QueryCommand, ScanCommand, type QueryCommandInput, type ScanCommandInput } from "@aws-sdk/lib-dynamodb"
import { dynamo } from "./dynamo"

// A Scan or Query returns at most 1 MB per call (before any FilterExpression is applied), so a
// single call can silently drop items. These follow LastEvaluatedKey until the result is complete.

export async function scanAll<T>(input: Omit<ScanCommandInput, "ExclusiveStartKey">): Promise<T[]> {
  const items: T[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const result = await dynamo.send(new ScanCommand({ ...input, ExclusiveStartKey }))
    items.push(...((result.Items ?? []) as T[]))
    ExclusiveStartKey = result.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

export async function queryAll<T>(input: Omit<QueryCommandInput, "ExclusiveStartKey">): Promise<T[]> {
  const items: T[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const result = await dynamo.send(new QueryCommand({ ...input, ExclusiveStartKey }))
    items.push(...((result.Items ?? []) as T[]))
    ExclusiveStartKey = result.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}
