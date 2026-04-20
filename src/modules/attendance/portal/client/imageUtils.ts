/**
 * Client-side image helpers for the /my portal.
 *
 * The clock-in/out endpoints accept any JPEG/PNG up to 12 MB and do their own
 * sharp-based resize server-side. We still do a browser-side downscale first
 * to keep the upload under ~500 KB — it saves the staff member's data (these
 * are field phones on 3G) and makes the request resilient to flaky links.
 *
 * A single cover-aspect downscale is enough for our needs; no EXIF rotation
 * here because the server already strips + re-orients via sharp.
 */

const DEFAULT_MAX_DIMENSION = 1024;
const DEFAULT_JPEG_QUALITY = 0.85;

/**
 * Thrown when a selected image file can't be decoded by this browser
 * (e.g. iOS HEIC on older Safari, corrupt JPEG, empty file). The caller
 * should surface "please retake the photo" copy rather than a bare
 * "something went wrong".
 */
export class ImageDecodeError extends Error {
  readonly reason: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'ImageDecodeError';
    this.reason = reason;
  }
}

/**
 * Convert a File (from a <input type=file capture=user>) into a base64 data
 * URL sized to fit DEFAULT_MAX_DIMENSION on its longer side. JPEG output,
 * quality 0.85. Returns the raw base64 string (no data-URL prefix) because
 * the server endpoint accepts either form.
 *
 * Throws ImageDecodeError when the browser can't decode the file.
 */
export async function fileToResizedBase64(file: File, opts: {
  maxDimension?: number;
  quality?: number;
} = {}): Promise<string> {
  const maxDim = opts.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = opts.quality ?? DEFAULT_JPEG_QUALITY;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new ImageDecodeError(
      'Could not decode the selected image — unsupported format or corrupt file.',
      err
    );
  }
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    // data:image/jpeg;base64,XXXX — strip the prefix so the payload is
    // smaller and the server doesn't have to choose between "base64" and
    // "data URL" on every request.
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  } finally {
    bitmap.close?.();
  }
}
