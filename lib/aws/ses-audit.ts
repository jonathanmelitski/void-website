import { SESv2Client, ListSuppressedDestinationsCommand, GetAccountCommand } from "@aws-sdk/client-sesv2"
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch"

const sesClient = new SESv2Client({
  region: process.env.VOID_REGION!,
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

const cwClient = new CloudWatchClient({
  region: process.env.VOID_REGION!,
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
})

export type SuppressedEmail = {
  email: string
  reason: "BOUNCE" | "COMPLAINT"
  lastUpdated: string
}

export type DailyMetrics = {
  date: string // YYYY-MM-DD
  sent: number
  delivered: number
  bounced: number
  complained: number
  rejected: number
}

export async function getSuppressedEmails(): Promise<SuppressedEmail[]> {
  const results: SuppressedEmail[] = []
  let nextToken: string | undefined

  do {
    const res = await sesClient.send(
      new ListSuppressedDestinationsCommand({ NextToken: nextToken, PageSize: 100 })
    )
    for (const item of res.SuppressedDestinationSummaries ?? []) {
      results.push({
        email: item.EmailAddress!,
        reason: item.Reason! as "BOUNCE" | "COMPLAINT",
        lastUpdated: item.LastUpdateTime?.toISOString() ?? "",
      })
    }
    nextToken = res.NextToken
  } while (nextToken)

  return results.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
}

export async function getSesAccountInfo() {
  const res = await sesClient.send(new GetAccountCommand({}))
  return {
    sendingEnabled: res.SendingEnabled ?? false,
    productionAccess: res.ProductionAccessEnabled ?? false,
    enforcementStatus: res.EnforcementStatus ?? "UNKNOWN",
  }
}

// AWS/SES CloudWatch metrics — automatically published by SES, no config set required.
// Period: 1 day (86400s). Returns last `days` days of data.
export async function getSesCloudWatchMetrics(days = 30): Promise<DailyMetrics[]> {
  const endTime = new Date()
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000)

  const metrics = ["Send", "Delivery", "Bounce", "Complaint", "Reject"] as const
  const idMap: Record<string, string> = {
    Send: "sent",
    Delivery: "delivered",
    Bounce: "bounced",
    Complaint: "complained",
    Reject: "rejected",
  }

  const res = await cwClient.send(
    new GetMetricDataCommand({
      StartTime: startTime,
      EndTime: endTime,
      MetricDataQueries: metrics.map(MetricName => ({
        Id: idMap[MetricName],
        MetricStat: {
          Metric: { Namespace: "AWS/SES", MetricName },
          Period: 86400, // 1 day
          Stat: "Sum",
        },
        ReturnData: true,
      })),
    })
  )

  // Build a map keyed by date
  const byDate = new Map<string, DailyMetrics>()

  for (const result of res.MetricDataResults ?? []) {
    const id = result.Id! as "sent" | "delivered" | "bounced" | "complained" | "rejected"
    const timestamps = result.Timestamps ?? []
    const values = result.Values ?? []
    for (let i = 0; i < timestamps.length; i++) {
      const date = timestamps[i].toISOString().slice(0, 10)
      if (!byDate.has(date)) {
        byDate.set(date, { date, sent: 0, delivered: 0, bounced: 0, complained: 0, rejected: 0 })
      }
      byDate.get(date)![id] = Math.round(values[i])
    }
  }

  return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date))
}
