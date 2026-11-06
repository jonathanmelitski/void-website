// Builds the SES mailbox-simulator test list: one topic (SIM_TOPIC) on the void-ultimate contact
// list, filled with @simulator.amazonses.com addresses through a single bulk import job.
//
//   npx tsx scripts/ses-sim-list.ts            # dry run: prints what it would do
//   npx tsx scripts/ses-sim-list.ts --apply    # creates the topic (if missing) and imports contacts
//
// Uses the AWS CLI's credentials (us-east-2). Only ever adds SIM_TOPIC; other topics are passed
// through unchanged. Re-running is safe: the import PUTs the same addresses again.
//
// Simulator mail never reaches a mailbox and doesn't affect sending reputation, but it does count
// against the daily quota (50k).
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import {
  SESv2Client, GetContactListCommand, UpdateContactListCommand, CreateImportJobCommand, GetImportJobCommand,
  ListContactsCommand,
} from "@aws-sdk/client-sesv2"
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { SIM_TOPIC } from "../email-worker/core"

const REGION = "us-east-2"
const CONTACT_LIST = "void-ultimate"

/** Address mix. success makes up most of the list; the rest produce delivery events. */
export const SIM_MIX = { success: 800, bounce: 50, complaint: 50, ooto: 50, suppressionlist: 50 } as const

export function simAddresses(): string[] {
  return Object.entries(SIM_MIX).flatMap(([kind, n]) =>
    Array.from({ length: n }, (_, i) => `${kind}+${String(i + 1).padStart(3, "0")}@simulator.amazonses.com`),
  )
}

function bucketName(): string {
  const arg = process.argv.find(a => a.startsWith("--bucket="))?.split("=")[1]
  if (arg) return arg
  if (process.env.S3_BUCKET_NAME) return process.env.S3_BUCKET_NAME
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").map(l => l.trim()).find(l => l.startsWith("S3_BUCKET_NAME="))
    if (line) return line.slice("S3_BUCKET_NAME=".length).trim().replace(/^"|"$/g, "")
  } catch {}
  throw new Error("No bucket: pass --bucket=<name> or set S3_BUCKET_NAME (the same bucket the app imports from)")
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function countTopic(ses: SESv2Client): Promise<number> {
  let n = 0
  let NextToken: string | undefined
  do {
    const page = await ses.send(new ListContactsCommand({
      ContactListName: CONTACT_LIST, PageSize: 1000, NextToken,
      Filter: { FilteredStatus: "OPT_IN", TopicFilter: { TopicName: SIM_TOPIC, UseDefaultIfPreferenceUnavailable: false } },
    }))
    n += page.Contacts?.length ?? 0
    NextToken = page.NextToken
    if (NextToken) await sleep(1100)
  } while (NextToken)
  return n
}

async function main() {
  const apply = process.argv.includes("--apply")
  const ses = new SESv2Client({ region: REGION })
  const emails = simAddresses()

  const list = await ses.send(new GetContactListCommand({ ContactListName: CONTACT_LIST }))
  const topics = list.Topics ?? []
  const hasTopic = topics.some(t => t.TopicName === SIM_TOPIC)
  console.log(`contact list ${CONTACT_LIST}: topics ${topics.map(t => t.TopicName).join(", ")}`)
  console.log(`${SIM_TOPIC}: ${hasTopic ? "exists" : "missing, will be created"}`)
  console.log(`addresses: ${emails.length} (${Object.entries(SIM_MIX).map(([k, n]) => `${k} ${n}`).join(", ")})`)
  if (hasTopic) console.log(`currently opted in: ${await countTopic(ses)}`)

  if (!apply) {
    console.log("\ndry run: nothing changed. Re-run with --apply.")
    return
  }

  const bucket = bucketName() // resolve before any write
  if (!hasTopic) {
    await ses.send(new UpdateContactListCommand({
      ContactListName: CONTACT_LIST,
      Description: list.Description,
      Topics: [...topics, {
        TopicName: SIM_TOPIC,
        DisplayName: "SES simulator (test)",
        Description: "Email-worker test list: @simulator.amazonses.com addresses only. See scripts/ses-sim-list.ts.",
        DefaultSubscriptionStatus: "OPT_OUT",
      }],
    }))
    console.log(`created topic ${SIM_TOPIC}`)
  }

  const s3 = new S3Client({ region: REGION })
  const key = `ses-imports/sim-${randomUUID()}.csv`
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key, ContentType: "text/csv",
    Body: [`emailAddress,topicPreferences.${SIM_TOPIC}`, ...emails.map(e => `${e},OPT_IN`)].join("\n"),
  }))

  try {
    const { JobId } = await ses.send(new CreateImportJobCommand({
      ImportDestination: { ContactListDestination: { ContactListName: CONTACT_LIST, ContactListImportAction: "PUT" } },
      ImportDataSource: { S3Url: `s3://${bucket}/${key}`, DataFormat: "CSV" },
    }))
    console.log(`import job ${JobId} started`)
    for (let i = 0; ; i++) {
      await sleep(2000)
      const job = await ses.send(new GetImportJobCommand({ JobId }))
      if (job.JobStatus === "COMPLETED" || job.JobStatus === "FAILED") {
        console.log(`import ${job.JobStatus}: processed ${job.ProcessedRecordsCount ?? 0}, failed ${job.FailedRecordsCount ?? 0}`)
        if (job.JobStatus === "FAILED") throw new Error(job.FailureInfo?.ErrorMessage ?? "import failed")
        break
      }
      if (i > 150) throw new Error(`import job ${JobId} still ${job.JobStatus} after 5 min`)
    }
  } finally {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {})
  }

  const n = await countTopic(ses)
  console.log(`${SIM_TOPIC} now has ${n} opted-in contacts`)
  if (n < emails.length) console.log("note: fewer than imported; some may have been opted out by bounce/complaint handling")
}

if (process.argv[1]?.endsWith("ses-sim-list.ts")) {
  main().catch(err => { console.error(err); process.exit(1) })
}
