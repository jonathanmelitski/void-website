import { NextRequest, NextResponse } from "next/server"
import {
  S3Client,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3"
import { verifyToken } from "@/lib/aws/cognito"
import { getClip, updateClip } from "@/lib/aws/film-clips"

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

  const { uploadId, s3Key } = await request.json()
  if (!uploadId || !s3Key) return NextResponse.json({ error: "uploadId and s3Key are required" }, { status: 400 })

  const bucket = process.env.FILM_S3_BUCKET_NAME!
  const client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-2" })

  // Gather ETags from S3 directly — client doesn't need to read response headers,
  // which avoids requiring ExposeHeaders: ["ETag"] in the bucket's CORS policy.
  const allParts: { PartNumber: number; ETag: string }[] = []
  let partMarker: string | undefined
  do {
    const listed = await client.send(new ListPartsCommand({
      Bucket: bucket,
      Key: s3Key,
      UploadId: uploadId,
      PartNumberMarker: partMarker,
    }))
    for (const part of listed.Parts ?? []) {
      if (part.PartNumber && part.ETag) {
        allParts.push({ PartNumber: part.PartNumber, ETag: part.ETag })
      }
    }
    partMarker = listed.IsTruncated ? listed.NextPartNumberMarker : undefined
  } while (partMarker !== undefined)

  if (allParts.length === 0) {
    return NextResponse.json({ error: "No parts found for this upload" }, { status: 400 })
  }

  allParts.sort((a, b) => a.PartNumber - b.PartNumber)

  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: s3Key,
    UploadId: uploadId,
    MultipartUpload: { Parts: allParts },
  }))

  // Clear the in-progress upload ID now that the object is assembled
  await updateClip(id, { s3UploadId: undefined, updatedAt: new Date().toISOString() })

  return NextResponse.json({ ok: true })
}
