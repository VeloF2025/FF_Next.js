/**
 * Selfie capture pipeline for the /my portal clock-in / clock-out flow.
 *
 * Responsibilities:
 *   1. Decode the base64 payload the client sent.
 *   2. Resize aggressively (sharp) — target ≤ 500 KB at JPEG quality 80.
 *      Field staff's phones upload 5-10 MB originals; storing those for
 *      90 days against hundreds of staff is a quota problem. A 500 KB
 *      selfie is ample for human review and retention cost.
 *   3. Upload to VF Storage under a predictable path so retention and
 *      POPIA access-log lookups stay simple.
 *
 * POPIA consent is enforced by the caller (clock-in handler rejects if
 * `attendance_credentials.selfie_consent_at` is null) — this module
 * doesn't know about consent, only about bytes.
 */

import sharp from 'sharp';
import { VFStorageService } from '@/services/vfStorageAdapter';
import { log } from '@/lib/logger';

const MAX_WIDTH_PX = 1024;
const MAX_HEIGHT_PX = 1024;
const TARGET_MAX_BYTES = 500 * 1024;
const MIN_QUALITY = 50;
const START_QUALITY = 80;

export type SelfieType = 'in' | 'out';

export interface SelfieUploadResult {
  /** Relative URL served via nginx proxy at `/storage/...` */
  url: string;
  /** Storage path inside VF Storage bucket — used for deletion during
   *  POPIA retention sweeps. */
  path: string;
  /** Actual bytes stored after compression. */
  size: number;
}

/**
 * Resize the input until it fits inside TARGET_MAX_BYTES. If the input is
 * already smaller, it's returned after a single re-encode (normalising
 * orientation/metadata). Throws when the image can't be decoded at all.
 */
async function resizeToTarget(input: Buffer): Promise<Buffer> {
  // First pass: constrain dimensions at START_QUALITY.
  let quality = START_QUALITY;
  let out = await sharp(input)
    .rotate() // honour EXIF orientation so "portrait" isn't sideways
    .resize({
      width: MAX_WIDTH_PX,
      height: MAX_HEIGHT_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  // Step down quality if still over budget. Bounded loop — worst case
  // ~4 iterations (80 → 70 → 60 → 50).
  while (out.length > TARGET_MAX_BYTES && quality > MIN_QUALITY) {
    quality -= 10;
    out = await sharp(input)
      .rotate()
      .resize({
        width: MAX_WIDTH_PX,
        height: MAX_HEIGHT_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }
  return out;
}

/**
 * Decode, resize, and upload a selfie base64 payload. Returns the stored
 * URL/path/size or throws on a structurally-invalid image.
 */
export async function storeSelfie(args: {
  base64: string;
  staffId: string;
  workDate: string;     // 'YYYY-MM-DD' — pre-computed server-side in SAST
  kind: SelfieType;
}): Promise<SelfieUploadResult> {
  const { base64, staffId, workDate, kind } = args;

  // Accept both plain base64 and data-URL payloads.
  const cleaned = base64.replace(/^data:image\/[a-z]+;base64,/i, '');
  let rawBuffer: Buffer;
  try {
    rawBuffer = Buffer.from(cleaned, 'base64');
  } catch (err) {
    log.warn('[attendance-selfie] base64 decode failed', {
      staffId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error('Selfie payload is not valid base64');
  }
  if (rawBuffer.length === 0) {
    throw new Error('Selfie payload is empty');
  }

  const resized = await resizeToTarget(rawBuffer);

  const fileName = `${kind}.jpg`;
  // Path shape matches the retention cron's glob: attendance/<staffId>/<workDate>/{in,out}.jpg
  const category = `${staffId}/${workDate}`;

  const storage = new VFStorageService();
  const result = await storage.uploadFile(resized, 'attendance', category, fileName);

  if (!result.success) {
    throw new Error('VF Storage upload reported non-success');
  }

  return {
    url: result.url,
    path: result.path,
    size: result.size ?? resized.length,
  };
}
