import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

export const s3 = new S3Client({
  region: process.env.VOID_REGION!,
  credentials: {
    accessKeyId: process.env.VOID_ACCESS_KEY_ID!,
    secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})

const BUCKET = () => process.env.S3_BUCKET_NAME!

export async function getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3, command, { expiresIn: 300 })
}

export async function listEventPhotos(eventId: string): Promise<string[]> {
  const prefix = `events/${eventId}/photos/`
  const result = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: prefix })
  )
  const base = process.env.NEXT_PUBLIC_S3_BASE_URL!
  return (result.Contents ?? [])
    .filter(obj => obj.Key && obj.Key !== prefix)
    .map(obj => `${base}/${obj.Key}`)
}
