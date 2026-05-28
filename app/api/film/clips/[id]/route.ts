import { NextRequest, NextResponse } from "next/server"
import { AbortMultipartUploadCommand, DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront"
import { verifyToken } from "@/lib/aws/cognito"
import { getClip, updateClip, deleteClip } from "@/lib/aws/film-clips"
import { getMediaConvertJobStatus } from "@/lib/aws/mediaconvert"

function invalidateManifest(clipId: string) {
  const cf = new CloudFrontClient({ region: "us-east-1" })
  cf.send(new CreateInvalidationCommand({
    DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID!,
    InvalidationBatch: {
      CallerReference: `retranscode-${clipId}-${Date.now()}`,
      Paths: { Quantity: 1, Items: [`/hls/${clipId}/index.m3u8`] },
    },
  })).catch(() => {}) // fire-and-forget
}

function s3() {
  return new S3Client({ region: process.env.AWS_REGION ?? "us-east-2" })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  try {
    let clip = await getClip(id)
    if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (clip.sourceType === "S3_HLS" && clip.status === "TRANSCODING" && clip.mediaConvertJobId) {
      try {
        const jobStatus = await getMediaConvertJobStatus(clip.mediaConvertJobId)
        const now = new Date().toISOString()
        if (jobStatus.status === "COMPLETE" && jobStatus.cloudfrontHlsUrl) {
          const updates = {
            status: "READY" as const,
            cloudfrontHlsUrl: jobStatus.cloudfrontHlsUrl,
            updatedAt: now,
            ...(jobStatus.durationSeconds != null ? { durationSeconds: jobStatus.durationSeconds } : {}),
          }
          await updateClip(id, updates)
          clip = { ...clip, ...updates }
          invalidateManifest(id)
        } else if (jobStatus.status === "ERROR") {
          const updates = { status: "ERROR" as const, errorMessage: jobStatus.errorMessage, updatedAt: now }
          await updateClip(id, updates)
          clip = { ...clip, ...updates }
        }
      } catch {
        // MediaConvert check failed — return current DB state
      }
    }

    return NextResponse.json(clip)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const groups = payload["cognito:groups"] ?? []
  if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json()
  const { title, durationSeconds } = body as { title?: string; durationSeconds?: number }

  try {
    const now = new Date().toISOString()
    const updates: Record<string, unknown> = { updatedAt: now }
    if (title !== undefined) updates.title = title
    if (durationSeconds !== undefined) updates.durationSeconds = durationSeconds
    await updateClip(id, updates)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const token = request.cookies.get("access_token")?.value
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const groups = payload["cognito:groups"] ?? []
  if (!groups.includes("COACH") && !groups.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const clip = await getClip(id)
    await deleteClip(id)

    // Fire-and-forget S3 cleanup for uploaded clips
    if (clip?.sourceType === "S3_HLS") {
      void (async () => {
        const bucket = process.env.FILM_S3_BUCKET_NAME!
        const client = s3()

        // Abort any in-progress multipart upload so S3 doesn't keep charging for orphaned parts
        if (clip.s3UploadId && clip.s3RawKey) {
          await client.send(new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: clip.s3RawKey,
            UploadId: clip.s3UploadId,
          })).catch(() => {})
        }

        // Delete raw file
        if (clip.s3RawKey) {
          await client.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: [{ Key: clip.s3RawKey }] },
          })).catch(() => {})
        }

        // Delete HLS output prefix
        const hlsPrefix = `hls/${id}/`
        const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: hlsPrefix })).catch(() => null)
        if (listed?.Contents && listed.Contents.length > 0) {
          await client.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: listed.Contents.map(o => ({ Key: o.Key! })) },
          })).catch(() => {})
        }
      })()
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete clip"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
