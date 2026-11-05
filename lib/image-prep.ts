/**
 * Client-side image preparation before an S3 upload (newsletter covers and inline images).
 * Downscales to a sane long edge and re-encodes as JPEG (or PNG when the image has
 * transparency) so emails and /news don't ship multi-MB camera originals or screenshots.
 * Browser-only (canvas / createImageBitmap).
 */

/** Types we accept from the file picker. HEIC etc. are rejected: most mail clients can't show them. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const
export const IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(",")

/** Hard cap on the original the user picks (we downscale, so this only guards against absurd files). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024
/** Cap on what is actually uploaded (GIFs are passed through untouched). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export type PreparedImage = { blob: Blob; contentType: "image/jpeg" | "image/png" | "image/gif" }

export class ImagePrepError extends Error {}

function isAllowed(type: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type)
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // Respect EXIF orientation so phone photos aren't rotated.
      return await createImageBitmap(file, { imageOrientation: "from-image" })
    } catch {
      /* fall through to <img> decode */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  // Sample the alpha channel on a coarse grid; enough to tell a logo from a photo/screenshot.
  const data = ctx.getImageData(0, 0, w, h).data
  const step = Math.max(1, Math.floor((w * h) / 40000)) * 4
  for (let i = 3; i < data.length; i += step) if (data[i] < 250) return true
  return false
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new ImagePrepError("Couldn't process that image"))), type, quality)
  )
}

/**
 * Validates and downsizes an image for upload. Throws ImagePrepError with a plain-language
 * message when the file can't be used.
 */
export async function prepareImageForUpload(
  file: File,
  { maxEdge = 1600, quality = 0.82 }: { maxEdge?: number; quality?: number } = {}
): Promise<PreparedImage> {
  if (!isAllowed(file.type)) {
    throw new ImagePrepError("Use a JPEG, PNG, WebP or GIF image. iPhone HEIC photos need exporting as JPEG first.")
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImagePrepError(`That image is too large (max ${MAX_SOURCE_BYTES / (1024 * 1024)} MB).`)
  }
  // Animated GIFs would lose their animation on a canvas; upload them as-is within the cap.
  if (file.type === "image/gif") {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ImagePrepError(`GIFs must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)
    }
    return { blob: file, contentType: "image/gif" }
  }

  let source: ImageBitmap | HTMLImageElement
  try {
    source = await decode(file)
  } catch {
    throw new ImagePrepError("Couldn't read that image. Try exporting it as a JPEG.")
  }
  const sw = "naturalWidth" in source ? source.naturalWidth : source.width
  const sh = "naturalHeight" in source ? source.naturalHeight : source.height
  const scale = Math.min(1, maxEdge / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new ImagePrepError("Couldn't process that image")
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, 0, 0, w, h)
  if ("close" in source) source.close()

  const transparent = file.type !== "image/jpeg" && hasTransparency(ctx, w, h)
  if (transparent) {
    const png = await toBlob(canvas, "image/png")
    if (png.size > MAX_UPLOAD_BYTES) throw new ImagePrepError("That image is too large even after resizing.")
    return { blob: png, contentType: "image/png" }
  }

  // Flatten onto white so any near-transparent edge pixels don't turn black in JPEG.
  ctx.globalCompositeOperation = "destination-over"
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, w, h)
  const jpeg = await toBlob(canvas, "image/jpeg", quality)
  // A small JPEG original can come out bigger after re-encoding; keep the original then.
  if (file.type === "image/jpeg" && scale === 1 && file.size <= jpeg.size && file.size <= MAX_UPLOAD_BYTES) {
    return { blob: file, contentType: "image/jpeg" }
  }
  return { blob: jpeg, contentType: "image/jpeg" }
}

/** PUTs a prepared image to a presigned S3 URL; throws on any non-2xx. */
export async function putToPresignedUrl(url: string, image: PreparedImage, signal?: AbortSignal): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { method: "PUT", body: image.blob, headers: { "Content-Type": image.contentType }, signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new ImagePrepError("Upload failed. Check your connection and try again.")
  }
  if (!res.ok) throw new ImagePrepError("Upload failed. Try again.")
}
