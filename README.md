# VOID Ultimate — Deployment Guide

> **This document is actively maintained.** When you add a new environment variable, AWS resource, GitHub Actions secret, or deployment step, update this file in the same pull request.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [AWS Resource Setup](#aws-resource-setup)
3. [Environment Variables](#environment-variables)
4. [GitHub Actions Secrets](#github-actions-secrets)
5. [Deployment](#deployment)
6. [Local Development](#local-development)
7. [Portability Notes](#portability-notes)

---

## Architecture Overview

The product is a Next.js SSR app (hosted on AWS Amplify) backed by a suite of AWS services. Two compute resources run outside of Amplify: a Lambda function for long-running broadcast jobs, and an ephemeral EC2 instance for the real-time WebSocket server.

| Service | Purpose |
|---|---|
| **AWS Amplify** | Hosts the Next.js SSR app; CI/CD triggered on push to `main` |
| **DynamoDB** | All persistent data across 11 tables |
| **Cognito** | Authentication and role-based access (USER / COACH / ADMIN) |
| **S3** | File uploads — event photos, newsletter images |
| **SES** | Newsletter email delivery and open/click tracking |
| **MediaLive** | Live RTMP ingest from OBS → scoreboard overlay → YouTube RTMP output |
| **Route53** | Manages `stream.voidultimate.com` and `live.voidultimate.com` dynamically |
| **EC2** | Ephemeral Node.js WebSocket server for real-time scoreboard; launched on demand |
| **Lambda** | `broadcast-worker` — async MediaLive lifecycle manager (up to 14.5 min runtime) |
| **Lambda** | `live-server-worker` — async EC2 launch/teardown manager (up to 14.5 min runtime) |
| **SSM Parameter Store** | Latest Ubuntu AMI lookup for EC2 launch |
| **SSM Run Command** | Remote log retrieval from the EC2 WebSocket server |
| **CloudWatch** | SES email delivery metrics |

### Data flow — live scoring

```
Admin scores a point in the manage panel
  → Next.js API updates DynamoDB
  → Next.js API POSTs to EC2 WebSocket server (/internal/push/:gameId)
  → WebSocket server fans out to all connected clients
  → Live scoreboard + public watch page update in real time
```

### Data flow — broadcasting

```
Admin clicks "Start Broadcast"
  → Next.js API creates job record in DynamoDB, invokes broadcast-worker Lambda (async)
  → Lambda: creates MediaLive input security group → RTMP input → channel
             → waits for IDLE → starts channel → waits for RUNNING
             → schedules scoreboard overlay → updates stream.voidultimate.com DNS
             → saves broadcast state to DynamoDB
  → Client polls GET /api/broadcast every 2s, reads step progress from DynamoDB
```

---

## AWS Resource Setup

### IAM

Create one IAM user for the application (used by the Next.js SSR app and the broadcast-worker Lambda via environment variables). Attach a policy with at minimum these permissions:

```
cognito-idp:*
dynamodb:GetItem, PutItem, UpdateItem, DeleteItem, Query, Scan
s3:GetObject, PutObject, DeleteObject, GetBucketLocation
ses:*
medialive:*
route53:ChangeResourceRecordSets, ListResourceRecordSets
ec2:RunInstances, DescribeInstances, TerminateInstances, AllocateAddress,
    AssociateAddress, ReleaseAddress, DescribeAddresses, CreateSecurityGroup,
    AuthorizeSecurityGroupIngress, DescribeSecurityGroups, DescribeSubnets,
    DescribeVpcs, CreateTags, DescribeTags
lambda:InvokeFunction
ssm:GetParameter, SendCommand, GetCommandInvocation
cloudwatch:GetMetricData
logs:CreateLogGroup, CreateLogDelivery
```

**MediaLiveAccessRole** — MediaLive requires a separate IAM role it can assume. Create a role named `MediaLiveAccessRole` (this name is hardcoded — see [Portability Notes](#portability-notes)) with this trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "medialive.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

Attach `AmazonS3FullAccess` and `CloudWatchLogsFullAccess` to this role.

**EC2 Instance Profile** — The WebSocket server needs an instance profile. Create a role with a trust policy for `ec2.amazonaws.com`, attach `AmazonDynamoDBReadOnlyAccess` and `CloudWatchAgentServerPolicy`, then create an instance profile with the same name and attach the role. Set `EC2_INSTANCE_PROFILE` to this profile name.

**Lambda worker execution role** — Both Lambda workers use explicit `VOID_ACCESS_KEY_ID` / `VOID_SECRET_ACCESS_KEY` env vars (not the execution role) to call AWS services at runtime. The role only needs basic Lambda execution permissions. One shared role covers all current and future workers:

```bash
aws iam create-role \
  --role-name void-lambda-worker-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name void-lambda-worker-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

The ARN printed by `create-role` goes in `LAMBDA_WORKER_ROLE_ARN` (one secret, used by all worker deployment workflows).

Both workflows also use `VOID_ACCESS_KEY_ID` / `VOID_SECRET_ACCESS_KEY` / `VOID_REGION` for the deployment step itself, so no separate `AWS_*` GitHub secrets are needed.

---

### Cognito

1. Create a **User Pool**. Note the Pool ID (e.g. `us-east-1_xxxxxxxx`) → `COGNITO_USER_POOL_ID`.
2. Create an **App Client** inside the pool:
   - Enable `ALLOW_USER_PASSWORD_AUTH`
   - Enable **Generate client secret** — the app uses server-side auth and requires it
   - Note the Client ID → `COGNITO_CLIENT_ID`
   - Note the Client Secret → `COGNITO_CLIENT_SECRET`
3. Create three **Groups**: `USER`, `COACH`, `ADMIN`
   - New users have no group until assigned via the admin panel
   - Only `ADMIN` members can access `/live/manage`

---

### DynamoDB

Create the following tables. All use `id` as the partition key (String) unless noted. On-demand billing mode is recommended.

| Table | Env Var | Default Name | GSIs Required |
|---|---|---|---|
| Events | `DYNAMO_EVENTS_TABLE` | `VoidEvents` | — |
| Newsletters | `DYNAMO_NEWSLETTERS_TABLE` | `VoidNewsletters` | — |
| Players | `DYNAMO_PLAYERS_TABLE` | `VoidPlayers` | — |
| Games | `DYNAMO_GAMES_TABLE` | `VoidGames` | `EventIdIndex` (PK: `eventId`) |
| Game Players | `DYNAMO_GAME_PLAYERS_TABLE` | `VoidGamePlayers` | `GameIdIndex` (PK: `gameId`), `PlayerIdIndex` (PK: `playerId`) |
| Points | `DYNAMO_POINTS_TABLE` | `VoidPoints` | `GameIdIndex` (PK: `gameId`, SK: `pointNumber` Number) |
| Point Events | `DYNAMO_POINT_EVENTS_TABLE` | `VoidPointEvents` | `PointIdIndex` (PK: `pointId`, SK: `sortOrder` Number), `GameIdIndex` (PK: `gameId`, SK: `sortOrder` Number) |
| Audit | `DYNAMO_AUDIT_TABLE` | `VoidAudit` | — |
| Newsletter Sends | `DYNAMO_SENDS_TABLE` | `VoidNewsletterSends` | — |
| Tracking | `DYNAMO_TRACKING_TABLE` | `VoidTracking` | — |
| Broadcast | `DYNAMO_BROADCAST_TABLE` | `VoidBroadcast` | — |

The Broadcast table uses a partition key named `pk` (String), not `id`. It holds two records: `singleton` (active broadcast state) and `job` (current job progress).

---

### S3

Create one bucket in your target region. Public access can remain blocked — the app uses presigned URLs for all uploads and reads.

Add this CORS configuration to allow browser-side presigned uploads:

```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["GET", "PUT", "POST"],
  "AllowedOrigins": ["https://voidultimate.com"],
  "ExposeHeaders": []
}]
```

Note the bucket name → `S3_BUCKET_NAME`.
Note the public base URL (e.g. `https://void-ultimate.s3.us-east-2.amazonaws.com`) → `NEXT_PUBLIC_S3_BASE_URL`.

---

### SES

1. **Verify your sending domain** in SES (add the DNS records SES provides to Route53).
2. **Request production access** — SES starts in sandbox mode and can only send to verified addresses until you request production access via the AWS console.
3. Create a **Contact List** for newsletter subscriber management. The list name goes in `SES_CONTACT_LIST_NAME` (default: `void-ultimate`). Each newsletter becomes a Topic within this list.
4. Set `SES_FROM_EMAIL` to your verified sending address.

---

### Route53

Create a hosted zone for your domain. The app dynamically manages two A records — do not create them manually, the app handles creation and deletion:

- `stream.voidultimate.com` — set to the MediaLive RTMP input endpoint IP when a broadcast is active; deleted on stop
- `live.voidultimate.com` — set to the EC2 Elastic IP when the live server is running; deleted on stop

Note the Hosted Zone ID → `ROUTE53_HOSTED_ZONE_ID`.

---

### MediaLive

No channels or inputs are pre-created — the app creates and destroys them per broadcast. The only pre-requisite is the `MediaLiveAccessRole` described in the [IAM section](#iam).

The role ARN is hardcoded in `nextjs/lib/aws/medialive.ts`. Update it to match your account before deploying (see [Portability Notes](#portability-notes)).

---

### EC2

No instances are pre-created. The live server panel in the admin UI launches an instance on demand using cloud-init to install Node 20, clone the repo, and start the WebSocket server. The same panel terminates the instance.

Pre-requisites:
- The EC2 Instance Profile (described in the [IAM section](#iam)) must exist before launching
- The repo referenced by `EC2_REPO_URL` must be accessible with `EC2_GITHUB_TOKEN`
- Port 3000 ingress is handled automatically — the app creates a security group on first launch

---

### Lambda (broadcast-worker and live-server-worker)

Both Lambda functions are **created automatically on the first GitHub Actions run** when their respective role ARNs are set. See [First-time setup](#first-time-setup) for the bootstrap sequence.

Configuration applied by both workflows:
- Runtime: `nodejs20.x`
- Memory: 512 MB
- Timeout: 870 seconds (14.5 minutes)
- Handler: `handler.handler`

---

## Environment Variables

In production these are injected by Amplify during the build phase via `amplify.yml`. For local development, copy `.env.example` to `.env.local` and fill in values.

### Core — required for the app to start

| Variable | Description |
|---|---|
| `VOID_REGION` | AWS region for all services (e.g. `us-east-1`) |
| `VOID_ACCESS_KEY_ID` | IAM access key |
| `VOID_SECRET_ACCESS_KEY` | IAM secret key |
| `NEXT_PUBLIC_BASE_URL` | Public origin of the app, no trailing slash (e.g. `https://voidultimate.com`) |

### Authentication — required for login to work

| Variable | Description |
|---|---|
| `COGNITO_USER_POOL_ID` | User Pool ID (e.g. `us-east-1_xxxxxxxx`) |
| `COGNITO_CLIENT_ID` | App client ID |
| `COGNITO_CLIENT_SECRET` | App client secret |

> Missing: all auth flows fail; the app is inaccessible.

### Data (DynamoDB) — required for all content features

| Variable | Default | Description |
|---|---|---|
| `DYNAMO_EVENTS_TABLE` | `VoidEvents` | Events |
| `DYNAMO_NEWSLETTERS_TABLE` | `VoidNewsletters` | Newsletters |
| `DYNAMO_AUDIT_TABLE` | `VoidAudit` | Audit trail |
| `DYNAMO_TRACKING_TABLE` | `VoidTracking` | Email tracking |
| `DYNAMO_SENDS_TABLE` | `VoidNewsletterSends` | Newsletter send records |
| `DYNAMO_GAMES_TABLE` | `VoidGames` | Games |
| `DYNAMO_POINTS_TABLE` | `VoidPoints` | Points/plays |
| `DYNAMO_POINT_EVENTS_TABLE` | `VoidPointEvents` | Point-level events |
| `DYNAMO_PLAYERS_TABLE` | `VoidPlayers` | Player roster |
| `DYNAMO_GAME_PLAYERS_TABLE` | `VoidGamePlayers` | Game lineups |
| `DYNAMO_BROADCAST_TABLE` | `VoidBroadcast` | Broadcast state + job tracking |

> Missing: API routes return 500 errors; all data features are broken.

### File Uploads (S3) — required for photo and image uploads

| Variable | Description |
|---|---|
| `S3_BUCKET_NAME` | S3 bucket name |
| `NEXT_PUBLIC_S3_BASE_URL` | Public URL prefix for S3 objects |

> Missing: event photos and newsletter images cannot be uploaded or displayed.

### Email / Newsletters (SES) — required for sending newsletters

| Variable | Description |
|---|---|
| `SES_FROM_EMAIL` | Verified sender address |
| `SES_CONTACT_LIST_NAME` | SES contact list name (default: `void-ultimate`) |
| `TOTP_SECRET` | Base32-encoded TOTP secret; gates bulk email sends with a 2FA code |

> Missing: newsletter sends fail. To generate a TOTP secret, use an online base32 generator or run `node -e "console.log(require('crypto').randomBytes(20).toString('hex'))"` and convert the output to base32.

### Live Broadcast (MediaLive + Lambda) — required for streaming

| Variable | Set in | Description |
|---|---|---|
| `BROADCAST_WORKER_FUNCTION_NAME` | Amplify Console | Name of the deployed broadcast-worker Lambda function |
| `YOUTUBE_STREAM_KEY` | GitHub Actions secret | YouTube RTMP stream key — injected into Lambda env only |
| `ROUTE53_HOSTED_ZONE_ID` | GitHub Actions secret | Hosted zone ID — injected into both Lambda envs only |

> `YOUTUBE_STREAM_KEY` and `ROUTE53_HOSTED_ZONE_ID` are consumed exclusively by the Lambda workers at runtime. Do **not** add them to the Amplify Console.
> Missing `BROADCAST_WORKER_FUNCTION_NAME`: the broadcast route falls back to an inline handler that times out on Amplify (29s API Gateway hard limit). Broadcast steps will appear to freeze.

### Live Server / Scoreboard (EC2 + WebSocket) — required for real-time scoreboard

| Variable | Set in | Description |
|---|---|---|
| `WS_SERVER_URL` | Amplify Console | Internal URL of the WebSocket server (e.g. `http://live.voidultimate.com:3000`) |
| `NEXT_PUBLIC_WS_HOST` | Amplify Console | Public WebSocket hostname for browser clients (e.g. `live.voidultimate.com:3000`) |
| `WS_INTERNAL_SECRET` | Amplify Console | Shared secret for the server-to-server score push endpoint (`POST /internal/push/:gameId`) |
| `LIVE_SERVER_WORKER_FUNCTION_NAME` | Amplify Console | Name of the deployed live-server-worker Lambda function |
| `EC2_INSTANCE_PROFILE` | GitHub Actions secret | IAM instance profile — injected into Lambda env only |
| `EC2_INSTANCE_TYPE` | GitHub Actions secret | EC2 instance type (default: `t3.micro`) — injected into Lambda env only |
| `EC2_REPO_URL` | GitHub Actions secret | Git repository URL — injected into Lambda env only |
| `EC2_REPO_BRANCH` | GitHub Actions secret | Branch to deploy (default: `main`) — injected into Lambda env only |
| `EC2_GITHUB_TOKEN` | GitHub Actions secret | GitHub PAT for cloning — injected into Lambda env only |

> All `EC2_*` vars are consumed exclusively by the live-server-worker Lambda. Do **not** add them to the Amplify Console.
> Missing `LIVE_SERVER_WORKER_FUNCTION_NAME`: the live server route falls back to an inline handler that times out on Amplify.
> Missing `WS_INTERNAL_SECRET`: score pushes to the WebSocket server will fail (unauthenticated).

---

## GitHub Actions Secrets

The Next.js app's environment variables are managed in the **Amplify Console**, not in GitHub — Amplify injects them during its own build pipeline via `amplify.yml`. GitHub Actions secrets are only used by the `deploy-broadcast-worker` and `deploy-live-server-worker` workflows.

Both workflows reuse the app's `VOID_*` credentials for the deployment step, so no separate `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` secrets are needed. The IAM user must also have `lambda:CreateFunction`, `lambda:UpdateFunctionCode`, `lambda:UpdateFunctionConfiguration`, `lambda:GetFunction` permissions.

Add these under **Settings → Secrets and variables → Actions**:

**Shared (used by both workflows)**

| Secret | Description |
|---|---|
| `VOID_ACCESS_KEY_ID` | IAM credentials — also used for Lambda deployment |
| `VOID_SECRET_ACCESS_KEY` | ^ |
| `VOID_REGION` | ^ |
| `LAMBDA_WORKER_ROLE_ARN` | Single execution role ARN shared by all Lambda workers |
| `DYNAMO_BROADCAST_TABLE` | Injected into Lambda env |
| `ROUTE53_HOSTED_ZONE_ID` | ^ |

**broadcast-worker only**

| Secret | Description |
|---|---|
| `BROADCAST_WORKER_FUNCTION_NAME` | Lambda function name (e.g. `void-broadcast-worker`) |
| `YOUTUBE_STREAM_KEY` | Injected into Lambda env |

**live-server-worker only**

| Secret | Description |
|---|---|
| `LIVE_SERVER_WORKER_FUNCTION_NAME` | Lambda function name (e.g. `void-live-server-worker`) |
| `EC2_INSTANCE_PROFILE` | Injected into Lambda env |
| `EC2_INSTANCE_TYPE` | ^ (optional, defaults to `t3.micro`) |
| `WS_INTERNAL_SECRET` | ^ |
| `EC2_REPO_URL` | ^ |
| `EC2_REPO_BRANCH` | ^ (optional, defaults to `main`) |
| `EC2_GITHUB_TOKEN` | ^ |
| `DYNAMO_GAMES_TABLE` | ^ |
| `DYNAMO_POINTS_TABLE` | ^ |
| `DYNAMO_POINT_EVENTS_TABLE` | ^ |
| `DYNAMO_PLAYERS_TABLE` | ^ |

---

## Deployment

### First-time setup

1. Complete all [AWS Resource Setup](#aws-resource-setup) steps.
2. In the **Amplify Console**, connect the repository and set all environment variables from the [Environment Variables](#environment-variables) section. Leave `BROADCAST_WORKER_FUNCTION_NAME` and `LIVE_SERVER_WORKER_FUNCTION_NAME` empty for now.
3. Add all [GitHub Actions Secrets](#github-actions-secrets). Set `BROADCAST_WORKER_FUNCTION_NAME` and `LIVE_SERVER_WORKER_FUNCTION_NAME` to your intended function names (e.g. `void-broadcast-worker`, `void-live-server-worker`).
4. Push to `main`. Three things happen simultaneously:
   - Amplify builds and deploys the Next.js app
   - GitHub Actions bundles and deploys the broadcast-worker Lambda (creating it on first run)
   - GitHub Actions bundles and deploys the live-server-worker Lambda (creating it on first run)
5. Once both Lambdas exist, add their names as `BROADCAST_WORKER_FUNCTION_NAME` and `LIVE_SERVER_WORKER_FUNCTION_NAME` in the **Amplify Console** environment variables.
6. Trigger a new Amplify build to pick up the new variables. Broadcasting and the live server are now fully operational.

### Normal deploys

- **Next.js app**: push to `main` → Amplify auto-deploys.
- **broadcast-worker**: any push to `broadcast-worker/`, `nextjs/lib/aws/broadcast-jobs.ts`, `nextjs/lib/aws/medialive.ts`, `nextjs/lib/step-types.ts`, or the workflow file triggers GitHub Actions to redeploy the Lambda.
- **live-server-worker**: any push to `live-server-worker/`, `nextjs/lib/aws/live-server-jobs.ts`, `nextjs/lib/step-types.ts`, or the workflow file triggers GitHub Actions to redeploy the Lambda.

The three deployments are independent and can run simultaneously.

---

## Local Development

```bash
cp nextjs/.env.example nextjs/.env.local
# Fill in credentials

cd nextjs
npm install
npm run dev
```

Without `BROADCAST_WORKER_FUNCTION_NAME` set, the broadcast API falls back to an inline SSE handler — fine for testing the UI locally. Without `LIVE_SERVER_WORKER_FUNCTION_NAME` set, the live server API does the same. The long-running wait steps will work locally as long as they complete within Node's default request timeout.

---

## Portability Notes

When deploying to a different AWS account or domain, update these hardcoded values:

| File | Hardcoded Value | What to change |
|---|---|---|
| `nextjs/lib/aws/medialive.ts` | `arn:aws:iam::217828988640:role/MediaLiveAccessRole` | Replace account ID with yours |
| `nextjs/lib/aws/medialive.ts` | `https://voidultimate.com/live/scoreboard` | Replace with your domain |
| `nextjs/lib/aws/broadcast-jobs.ts` | `stream.voidultimate.com` | Replace with your streaming subdomain |
| `nextjs/lib/aws/live-server-jobs.ts` | `live.voidultimate.com` | Replace with your WebSocket subdomain |
