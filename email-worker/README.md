# void-email-worker

Sends a newsletter to a whole contact list from a Lambda, so the send doesn't depend on the Amplify
request (Amplify ends requests after about 30 s, which cut the 627-person alumni list off at about 200).

## How it works

```
Admin presses Send → TOTP → POST /api/marketing/send
  ├─ ADMIN check → TOTP → base-URL guard → send record in VoidEmailSends (status=queued, engine=worker, runId)
  ├─ Lambda Invoke (InvocationType=Event) void-email-worker {sendId, runId}
  ├─ awaited audit row
  └─ 202 {sendId}                          ← returns in < 1 s
UI: SendMonitor polls GET /api/marketing/sends/<id>?summary=1 every 2 s (10 s when the tab is hidden).
    ?send=<id> in the URL, and GET /api/marketing/sends/active on load, re-attach it after a reload.

void-email-worker (email-worker/handler.ts → core.ts)
  1. Load the job. Exit if its runId changed (superseded), or it's complete/cancelled.
  2. First run only: list contacts (≈1 req/s, backoff on TooManyRequests), dedupe in lower case,
     conditional-put one PENDING row per address into VoidEmailSendRecipients (PK sendId, SK email).
  3. Loop: re-read the job (cancel? superseded?) → take up to min(SES MaxSendRate, 10) PENDING rows →
     conditional PENDING→SENDING per row → SendEmail (backoff on throttling, 5 tries) → SENT / FAILED →
     ADD recipientCount / failedCount on the job, heartbeat updatedAt → wait out the second.
  4. With < 60 s of Lambda time left: re-invoke itself with the same {sendId, runId} and exit.
  5. No PENDING rows left: status=complete, unknownCount = rows still SENDING, awaited audit row.
```

- **No double sends.** An address is only emailed after its row moves PENDING→SENDING under a
  condition, so a retry, a hand-off or a resume can't send it twice. Rows left in SENDING by a crash
  are shown as "unconfirmed" and are never re-sent automatically.
- **Resume** (UI, ADMIN + TOTP, audited) gives the job a new runId and invokes the worker again; it
  carries on with the PENDING rows. The old run, if somehow still alive, fails its next conditional
  write and stops.
- **Cancel** (UI, ADMIN, audited) sets `cancelRequested`; the worker stops before its next batch.
- **Dry run** walks the list and marks rows DRYRUN. The handler never builds an SES sender for a dry
  run, and `runWorker` refuses to start if a dry run is given one.
- **Feature flag.** The app uses the worker only when both `EMAIL_WORKER_FUNCTION_NAME` and
  `DYNAMO_SEND_RECIPIENTS_TABLE` are set. Otherwise it falls back to the in-request stopgap
  (progress saved every batch, a clean pause at about 22 s, then Resume).
- Lambda async invokes are set to **0 retries**, so a failure doesn't re-run on its own. The job is
  marked `failed` with a plain-language `lastError`, and the admin resumes it.

## Resources (us-east-2, account 217828988640)

| Resource | Name | Notes |
|---|---|---|
| DynamoDB table | `VoidEmailSendRecipients` | PK `sendId` (S), SK `email` (S), PAY_PER_REQUEST |
| IAM role | `void-email-worker-role` | trust: lambda.amazonaws.com; `AWSLambdaBasicExecutionRole` + inline `void-email-worker` (iam-policy.json) |
| Lambda | `void-email-worker` | nodejs20.x, handler `handler.handler`, timeout 900 s, 512 MB, async retries 0 |
| GitHub workflow | `.github/workflows/deploy-email-worker.yml` | updates the code on push to main |

All are tagged `project=void`, `component=email-worker`.

### Worker environment

| Var | Value |
|---|---|
| `DYNAMO_SENDS_TABLE` | `VoidEmailSends` |
| `DYNAMO_SEND_RECIPIENTS_TABLE` | `VoidEmailSendRecipients` |
| `DYNAMO_NEWSLETTERS_TABLE` | `VoidNewsletters` |
| `DYNAMO_AUDIT_TABLE` | `VoidAuditLogs` |
| `SES_CONTACT_LIST_NAME` | `void-ultimate` |
| `SES_FROM_EMAIL` | same as the app |
| `NEXT_PUBLIC_BASE_URL` | `https://voidultimate.com` (must be public https; the worker refuses otherwise) |
| `NEXT_PUBLIC_S3_BASE_URL` | same as the app |

The worker uses its role. No access keys are passed to it, unlike broadcast-worker.

## Setup commands

Steps 1–4 create **new** resources only. Run them from the repo root with the account's CLI profile.

```sh
export AWS_REGION=us-east-2

# 1. Per-recipient table
aws dynamodb create-table --region us-east-2 \
  --table-name VoidEmailSendRecipients \
  --attribute-definitions AttributeName=sendId,AttributeType=S AttributeName=email,AttributeType=S \
  --key-schema AttributeName=sendId,KeyType=HASH AttributeName=email,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=project,Value=void Key=component,Value=email-worker
aws dynamodb wait table-exists --region us-east-2 --table-name VoidEmailSendRecipients

# 2. Worker role (least privilege)
aws iam create-role --role-name void-email-worker-role \
  --assume-role-policy-document file://email-worker/trust-policy.json \
  --tags Key=project,Value=void Key=component,Value=email-worker
aws iam attach-role-policy --role-name void-email-worker-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --role-name void-email-worker-role \
  --policy-name void-email-worker --policy-document file://email-worker/iam-policy.json
sleep 15   # IAM propagation before Lambda can assume the role

# 3. Build + create the function
mkdir -p email-worker/dist
node_modules/.bin/esbuild email-worker/handler.ts --bundle --platform=node --target=node20 \
  --outfile=email-worker/dist/handler.js
(cd email-worker/dist && zip -q function.zip handler.js)
aws lambda create-function --region us-east-2 \
  --function-name void-email-worker \
  --runtime nodejs20.x --handler handler.handler \
  --role arn:aws:iam::217828988640:role/void-email-worker-role \
  --timeout 900 --memory-size 512 \
  --zip-file fileb://email-worker/dist/function.zip \
  --environment "Variables={DYNAMO_SENDS_TABLE=VoidEmailSends,DYNAMO_SEND_RECIPIENTS_TABLE=VoidEmailSendRecipients,DYNAMO_NEWSLETTERS_TABLE=VoidNewsletters,DYNAMO_AUDIT_TABLE=VoidAuditLogs,SES_CONTACT_LIST_NAME=void-ultimate,SES_FROM_EMAIL=<same as app>,NEXT_PUBLIC_BASE_URL=https://voidultimate.com,NEXT_PUBLIC_S3_BASE_URL=<same as app>}" \
  --tags project=void,component=email-worker
aws lambda wait function-active --region us-east-2 --function-name void-email-worker
aws lambda put-function-event-invoke-config --region us-east-2 \
  --function-name void-email-worker --maximum-retry-attempts 0

# 4. Setup check: dry run that can't send (in-memory job, rows under a dryrun-* id), then clean up
ID="dryrun-$(uuidgen | tr A-Z a-z)"
aws lambda invoke --region us-east-2 --function-name void-email-worker \
  --cli-binary-format raw-in-base64-out \
  --payload "{\"sendId\":\"$ID\",\"runId\":\"setup\",\"dryRun\":true,\"ephemeral\":{\"listName\":\"test-list\"}}" \
  /dev/stdout
# delete only the rows that dry run created
aws dynamodb query --region us-east-2 --table-name VoidEmailSendRecipients \
  --key-condition-expression "sendId = :id" --expression-attribute-values "{\":id\":{\"S\":\"$ID\"}}" \
  --projection-expression email --output json   # then delete-item each {sendId: $ID, email}
```

### Steps for you (they change existing things, so they weren't run)

5. **App permission to invoke the worker and read the new table.** The app's IAM user
   (`void-website-serverside`) already has `AWSLambda_FullAccess` and `AmazonDynamoDBFullAccess`, so
   nothing needs adding. To scope it down later, the minimum it needs is:
   ```sh
   aws iam put-user-policy --user-name void-website-serverside --policy-name VoidEmailWorkerInvoke \
     --policy-document '{"Version":"2012-10-17","Statement":[
       {"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:us-east-2:217828988640:function:void-email-worker"},
       {"Effect":"Allow","Action":"dynamodb:Query","Resource":"arn:aws:dynamodb:us-east-2:217828988640:table/VoidEmailSendRecipients"}]}'
   ```
   If Amplify's server uses a different identity, run that command against that identity instead.
6. **Turn the worker on.** In the Amplify console (app `d28sjan51i1ciw`, branch `main`) → Environment
   variables, add these, then redeploy:
   - `EMAIL_WORKER_FUNCTION_NAME=void-email-worker`
   - `DYNAMO_SEND_RECIPIENTS_TABLE=VoidEmailSendRecipients`

   Leave them out of local `.env.local`, so local dev never invokes the worker. To turn the worker
   off, remove them.
7. **First real use.** Run a **Dry run** from the send dialog on `void-alumni` (no email goes out).
   Then do a real send to `test-list` and watch the monitor, reload mid-send, and check Delivery.
   Only after that, use the alumni list. Up to ~200 alumni probably got the 2026-05-01 email; check
   CloudWatch first if you want to avoid duplicates.

### Removing everything

```sh
aws lambda delete-function --region us-east-2 --function-name void-email-worker
aws iam delete-role-policy --role-name void-email-worker-role --policy-name void-email-worker
aws iam detach-role-policy --role-name void-email-worker-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name void-email-worker-role
aws dynamodb delete-table --region us-east-2 --table-name VoidEmailSendRecipients
```
