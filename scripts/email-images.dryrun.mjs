#!/usr/bin/env node
/**
 * READ-ONLY dry run: lists every newsletter image in S3 (prefix `newsletters/`) and reports its
 * size, real format, pixel dimensions and stored Content-Type, plus what the upload pipeline in
 * lib/image-prep.ts WOULD produce for it (long edge ≤ 1600px, JPEG q0.82, PNG kept only when it has
 * transparency, GIF untouched).
 *
 * It never writes: only ListObjectsV2, HeadObject and GetObject are called. Re-processing the
 * existing objects is a separate, approval-gated step (write resized copies to NEW keys, then
 * repoint coverPhotoKey / body src; keep originals because sent emails still reference them).
 *
 * Usage:  node scripts/email-images.dryrun.mjs            # header-only (fast; ranged GET for dims)
 *         node scripts/email-images.dryrun.mjs --estimate # full download + in-memory re-encode to
 *                                                         # report the real output size (slow on big files)
 *         node scripts/email-images.dryrun.mjs --json     # machine-readable output
 * Credentials: VOID_REGION / VOID_ACCESS_KEY_ID / VOID_SECRET_ACCESS_KEY / S3_BUCKET_NAME from
 * the environment or .env.local (values are never printed).
 */
import fs from "node:fs"
import path from "node:path"
import { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import sharp from "sharp"

const MAX_EDGE = 1600
const QUALITY = 82
const HEAD_BYTES = 512 * 1024
const args = new Set(process.argv.slice(2))
const ESTIMATE = args.has("--estimate")
const JSON_OUT = args.has("--json")

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
loadEnvLocal()

for (const k of ["VOID_REGION", "VOID_ACCESS_KEY_ID", "VOID_SECRET_ACCESS_KEY", "S3_BUCKET_NAME"]) {
  if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1) }
}
const Bucket = process.env.S3_BUCKET_NAME
const s3 = new S3Client({
  region: process.env.VOID_REGION,
  credentials: { accessKeyId: process.env.VOID_ACCESS_KEY_ID, secretAccessKey: process.env.VOID_SECRET_ACCESS_KEY },
})

async function bodyBuffer(body) {
  const chunks = []
  for await (const c of body) chunks.push(c)
  return Buffer.concat(chunks)
}

async function listAll(Prefix) {
  const out = []
  let ContinuationToken
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }))
    for (const o of r.Contents ?? []) if (o.Key && !o.Key.endsWith("/")) out.push(o)
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (ContinuationToken)
  return out
}

function plan(meta, isCover) {
  const { format, width, height, hasAlpha } = meta
  if (!width || !height) return { action: "skip", reason: "unreadable" }
  if (format === "gif") return { action: "keep", reason: "GIF passed through" }
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const w = Math.round(width * scale), h = Math.round(height * scale)
  const outFormat = hasAlpha && format === "png" ? "png" : "jpeg"
  const ext = outFormat === "png" ? "png" : "jpg"
  return {
    action: scale < 1 || format !== outFormat ? "reencode" : "reencode-if-smaller",
    out: `${w}x${h} ${outFormat}${outFormat === "jpeg" ? ` q${QUALITY}` : ""}`,
    newKeyPattern: isCover ? `newsletters/<id>/cover-<uuid>.${ext}` : `newsletters/images/<uuid>.${ext}`,
    outFormat, w, h,
  }
}

const rows = []
const objects = await listAll("newsletters/")
for (const o of objects) {
  const Key = o.Key
  const row = { key: Key, bytes: o.Size }
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key }))
    row.contentType = head.ContentType
    row.cacheControl = head.CacheControl ?? null
    const full = ESTIMATE
    const get = await s3.send(new GetObjectCommand({ Bucket, Key, ...(full ? {} : { Range: `bytes=0-${HEAD_BYTES - 1}` }) }))
    let buf = await bodyBuffer(get.Body)
    let meta
    try { meta = await sharp(buf).metadata() } catch {
      if (!full && o.Size > HEAD_BYTES) { // dimensions beyond the first chunk: fetch whole object
        buf = await bodyBuffer((await s3.send(new GetObjectCommand({ Bucket, Key }))).Body)
        meta = await sharp(buf).metadata()
      } else throw new Error("not an image sharp can read")
    }
    row.format = meta.format
    row.dims = `${meta.width}x${meta.height}`
    row.hasAlpha = !!meta.hasAlpha
    row.typeMismatch = !!meta.format && !(row.contentType ?? "").includes(meta.format === "jpeg" ? "jpeg" : meta.format)
    row.extMismatch = !Key.toLowerCase().endsWith(meta.format === "jpeg" ? ".jpg" : `.${meta.format}`)
    const isCover = /\/cover[^/]*$/.test(Key)
    const p = plan(meta, isCover)
    row.wouldProduce = p.out ?? p.reason
    row.newKey = p.newKeyPattern
    if (ESTIMATE && p.outFormat) {
      const img = sharp(buf).rotate().resize({ width: p.w, height: p.h, fit: "inside" })
      const out = p.outFormat === "png" ? await img.png().toBuffer() : await img.flatten({ background: "#ffffff" }).jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer()
      row.estimatedBytes = out.length
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  rows.push(row)
  if (!JSON_OUT) {
    const kb = n => (n == null ? "?" : `${Math.round(n / 1024)}KB`)
    console.log(
      [row.key, kb(row.bytes), row.contentType, row.format, row.dims,
        row.typeMismatch ? "TYPE≠" : "", row.extMismatch ? "EXT≠" : "",
        "→", row.wouldProduce ?? "", row.estimatedBytes != null ? `≈${kb(row.estimatedBytes)}` : "",
        row.error ? `ERROR ${row.error}` : ""].filter(Boolean).join("  ")
    )
  }
}
if (JSON_OUT) console.log(JSON.stringify(rows, null, 2))
else {
  const total = rows.reduce((s, r) => s + (r.bytes ?? 0), 0)
  const est = rows.reduce((s, r) => s + (r.estimatedBytes ?? 0), 0)
  console.log(`\n${rows.length} objects, ${Math.round(total / 1024 / 1024 * 10) / 10} MB total${ESTIMATE ? `, ≈${Math.round(est / 1024 / 1024 * 10) / 10} MB after re-encode` : ""}. Nothing was written.`)
}
