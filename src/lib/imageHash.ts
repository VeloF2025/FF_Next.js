/**
 * Perceptual image hashing (dHash) for nearest-example selection.
 *
 * Used to pick the gallery few-shot examples that most VISUALLY RESEMBLE the
 * photo being judged, instead of just the most recently curated ones — the VLM
 * anchors far better on a relevant example (see vlmGallery.ts).
 *
 * dHash (difference hash): downscale to 9×8 greyscale, then for each row emit a
 * bit per adjacent-pixel pair (left brighter than right). 64 bits → 16 hex
 * chars. Robust to resolution/compression/minor brightness — exactly what we
 * want for "is this the same kind of scene", and resolution-independent so the
 * query photo and the stored gallery images compare cleanly regardless of size.
 *
 * NOTE: this is a relevance signal, NOT a duplicate check — exact-duplicate
 * detection is SHA-256 (photoHashService.ts / pwa_photo_hashes).
 */

import sharp from 'sharp';

/** Hash width in pixels; emits (HASH_W-1) bits per row. */
const HASH_W = 9;
const HASH_H = 8;

/**
 * Compute the dHash of a base64 (or data-URL) image. Returns 16 lowercase hex
 * chars (64 bits), or null if the image can't be decoded.
 */
export async function computeDHash(imageBase64: string): Promise<string | null> {
  try {
    const stripped = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
    const buf = Buffer.from(stripped, 'base64');
    // fit:'fill' forces the exact grid so the bit positions are stable.
    const pixels = await sharp(buf)
      .greyscale()
      .resize(HASH_W, HASH_H, { fit: 'fill' })
      .raw()
      .toBuffer();

    let bits = '';
    for (let row = 0; row < HASH_H; row++) {
      for (let col = 0; col < HASH_W - 1; col++) {
        const left = pixels[row * HASH_W + col]!;
        const right = pixels[row * HASH_W + col + 1]!;
        bits += left > right ? '1' : '0';
      }
    }

    // 64 bits → 16 hex chars.
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

/**
 * Hamming distance between two equal-length hex dHashes (number of differing
 * bits, 0–64). Returns Infinity if the inputs are malformed or mismatched, so
 * callers rank such rows last.
 */
export function hammingDistance(hexA: string, hexB: string): number {
  if (!hexA || !hexB || hexA.length !== hexB.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < hexA.length; i++) {
    const a = parseInt(hexA[i]!, 16);
    const b = parseInt(hexB[i]!, 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
    let xor = a ^ b;
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}
