/**
 * Shared browser-side image downscaler for the offline-photo PWA queue.
 *
 * Generalised from src/modules/attendance/portal/client/imageUtils.ts. Bounds a
 * 5–12 MB camera original to a predictable ~200–500 KB JPEG (long edge ≤ 1600px,
 * quality 0.8) BEFORE it is enqueued, so the offline queue's byte budget
 * (`maxQueueBytes`) is tractable and reconnect uploads are viable on 3G.
 *
 * Unlike the attendance selfie helper (which returns base64 and lets the server
 * re-orient), this returns a native `Blob` (stored directly in IndexedDB, −33 %
 * vs base64) and honours EXIF orientation at decode time via
 * `createImageBitmap(..., { imageOrientation: 'from-image' })` so a queued photo
 * uploads upright even when the server never sees the original EXIF.
 */

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.8;
const DEFAULT_MIME = 'image/jpeg';

/**
 * Thrown when an image can't be decoded (unsupported format / corrupt file /
 * iOS HEIC on old Safari) or the browser lacks the canvas primitives. The
 * caller should surface "please retake the photo" copy — never a silent drop.
 */
export class ImageDecodeError extends Error {
  readonly reason: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'ImageDecodeError';
    this.reason = reason;
  }
}

export interface DownscaleOptions {
  /** Longest-edge cap in px. Default 1600. */
  maxEdge?: number;
  /** JPEG quality 0–1. Default 0.8. */
  quality?: number;
  /** Output MIME type. Default 'image/jpeg'. */
  mimeType?: string;
}

/**
 * Target dimensions that fit `(width, height)` within `maxEdge` on the longer
 * side, preserving aspect ratio. Never upscales. Pure — the testable geometry
 * core of the downscale.
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageDecodeError('Canvas produced no image blob.'))),
      mimeType,
      quality
    );
  });
}

/**
 * Downscale an image `File`/`Blob` to a bounded JPEG `Blob`. Rejects with
 * `ImageDecodeError` on a decode failure or an environment without the required
 * canvas / createImageBitmap primitives (never resolves silently).
 */
export async function downscaleImage(file: Blob, opts: DownscaleOptions = {}): Promise<Blob> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const mimeType = opts.mimeType ?? DEFAULT_MIME;

  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new ImageDecodeError(
      'Image downscaling is unavailable in this environment (no canvas / createImageBitmap).'
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    throw new ImageDecodeError(
      'Could not decode the selected image — unsupported format or corrupt file.',
      err
    );
  }

  try {
    const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageDecodeError('Canvas 2D context unavailable.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await canvasToBlob(canvas, mimeType, quality);
  } finally {
    bitmap.close?.();
  }
}
