import { NextRequest, NextResponse } from "next/server"
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { verifyToken } from "@/lib/aws/cognito"
import { getClip, updateClip } from "@/lib/aws/film-clips"

// 10 MB per part — keeps each part well within the 1-hour presign expiry
// even on very slow connections, and limits re-upload on per-part retry.
export const PART_SIZE = 10 * 1024 * 1024

export async function POST(
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

  const clip = await getClip(id)
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { contentType, filename, fileSize } = await request.json()
  if (!contentType) return NextResponse.json({ error: "contentType is required" }, { status: 400 })
  if (!fileSize || fileSize <= 0) return NextResponse.json({ error: "fileSize is required" }, { status: 400 })

  const ext = filename ? filename.split(".").pop() ?? "mp4" : contentType.split("/")[1] ?? "mp4"
  const s3Key = `raw/${id}.${ext}`
  const bucket = process.env.FILM_S3_BUCKET_NAME!
  const client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-2" })

  // Abort any orphaned multipart upload from a previous interrupted attempt
  if (clip.s3UploadId && clip.s3RawKey) {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: clip.s3RawKey,
      UploadId: clip.s3UploadId,
    })).catch(() => {})
  }

  // Start a new multipart upload
  const create = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: contentType,
  }))
  const uploadId = create.UploadId!

  // Persist s3RawKey + s3UploadId immediately so DELETE can abort if the user cancels
  await updateClip(id, { s3RawKey: s3Key, s3UploadId: uploadId, updatedAt: new Date().toISOString() })

  // Generate a presigned URL for each part (pure HMAC — no extra HTTP calls to S3)
  const partCount = Math.ceil(fileSize / PART_SIZE)
  const parts = await Promise.all(
    Array.from({ length: partCount }, (_, i) => {
      const partNumber = i + 1
      return getSignedUrl(
        client,
        new UploadPartCommand({ Bucket: bucket, Key: s3Key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: 3600 }
      ).then(uploadUrl => ({ partNumber, uploadUrl }))
    })
  )

  return NextResponse.json({ uploadId, s3Key, parts })
}
