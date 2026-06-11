/**
 * Serial-extraction pipeline for POST /api/my/stores/serials/extract.
 *
 * Order: (1) zxing-wasm barcode decode on the ORIGINAL-resolution image
 * (density matters for dense Code128 — resizing first destroys it), then
 * (2) one Qwen3-VL call on a 1024x768 resize (endpoint does the resize).
 * Both produce a candidate that must pass validateSerialCandidate before it
 * reaches the client.
 *
 * Known serial families (stores stock, 2026-06):
 *   ont     ALCLB4 + 6 hex chars (12 total)     — Nokia GPON ONT
 *   gizzu   GU18W12V25 + 8 digits (18 total)    — Gizzu UPS
 *   generic fallback: 6-24 chars A-Z 0-9 '-' (VLM hits get confidence-capped)
 */

import sharp from 'sharp';
import { extractScannedSerial } from '@/modules/field-stock-pwa/lib/scannedSerial';
import {
  VLM_CHAT_ENDPOINT,
  VLM_EXTRACTION_MODEL,
  VLM_MAX_TOKENS_OCR,
  VLM_TEMPERATURE,
  VLM_TIMEOUT_REALTIME,
} from '@/lib/vlm';
import { log } from '@/lib/logger';

export type SerialFamily = 'ont' | 'gizzu' | 'generic';

const ONT_RE = /^ALCLB4[0-9A-F]{6}$/;
const GIZZU_RE = /^GU18W12V25\d{8}$/;
const GENERIC_RE = /^[A-Z0-9][A-Z0-9-]{4,22}[A-Z0-9]$/;

/** Serials appearing as examples in VLM prompts/docs — hallucination guard. */
const PROMPT_EXAMPLE_SERIALS = new Set(['ALCLB4923FA8']);

/** SSID / part-number prefixes that are NOT serials. */
const REJECT_PREFIXES = ['ALHN', 'STN', '3TN'];

export function validateSerialCandidate(
  raw: string,
): { serial: string; family: SerialFamily } | null {
  const serial = raw.trim().toUpperCase();
  if (serial.length < 6 || PROMPT_EXAMPLE_SERIALS.has(serial)) return null;
  if (REJECT_PREFIXES.some((p) => serial.startsWith(p))) return null;
  if (ONT_RE.test(serial)) return { serial, family: 'ont' };
  if (GIZZU_RE.test(serial)) return { serial, family: 'gizzu' };
  if (GENERIC_RE.test(serial)) return { serial, family: 'generic' };
  return null;
}

/**
 * Decode barcode from an image buffer.
 *
 * Passes ImageData (not a Blob) to readBarcodes because jsdom's Blob polyfill
 * lacks .arrayBuffer(), which zxing needs internally for the Blob path. The
 * ImageData path works in both Node and test environments.
 */
export async function decodeSerialFromImage(buffer: Buffer): Promise<string | null> {
  try {
    const { readBarcodes } = await import('zxing-wasm/full');

    // Decode to raw RGBA pixels; sharp handles any input format (JPEG/PNG/WebP).
    const { data, info } = await sharp(buffer).raw().ensureAlpha().toBuffer({
      resolveWithObject: true,
    });

    // zxing-wasm types expect DOM ImageData; in Node we provide the required
    // subset (data/width/height) and cast — the wasm only reads those fields.
    const imageData = {
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    } as unknown as ImageData;

    const results = await readBarcodes(imageData, {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    });

    for (const r of results) {
      // zxing-wasm renders ISO 15434 control bytes as Unicode Control Pictures
      // (U+241D/241E/2404) rather than raw bytes. Normalise back so that
      // extractScannedSerial (which splits on \x1d/\x1e/\x04) works correctly.
      const normalised = r.text
        .replace(/␝/g, '\x1d')
        .replace(/␞/g, '\x1e')
        .replace(/␄/g, '\x04');
      const unwrapped = extractScannedSerial(normalised).toUpperCase();
      if (validateSerialCandidate(unwrapped)) return unwrapped;
    }
    return null;
  } catch (err) {
    log.warn('serial extract: zxing decode failed', { err }, 'my/stores/serials/extract');
    return null;
  }
}

export const STORES_SERIAL_PROMPT = `You are reading an equipment label photo from a fibre-network warehouse.
Find the SERIAL NUMBER on the label. Known formats:
- Nokia ONT: starts "ALCLB4", exactly 12 characters (letters/digits), printed after "S/N:".
- Gizzu UPS: starts "GU18W12V25", exactly 18 characters, printed under a 1D barcode.
- Otherwise: the value labelled "S/N", "Serial", or "SN".
NOT serials: SSID (starts ALHN), part numbers (start STN or 3TN), MAC addresses (colon-separated hex), model numbers, batch codes.
Reply with ONLY JSON: {"serial": "<value or null>", "confidence": <0..1>}
If no serial is clearly readable, reply {"serial": null, "confidence": 0}.`;

export function parseVlmSerialResponse(
  content: string,
): { serial: string | null; confidence: number } | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { serial?: unknown; confidence?: unknown };
    return {
      serial: typeof parsed.serial === 'string' ? parsed.serial : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };
  } catch (err) {
    log.warn('serial extract: VLM response was not valid JSON', { err }, 'my/stores/serials/extract');
    return null;
  }
}

/** One VLM call on a pre-resized JPEG buffer. Returns a VALIDATED serial or null. */
export async function extractSerialWithVlm(
  resizedJpeg: Buffer,
): Promise<{ serial: string; family: SerialFamily; confidence: number } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_REALTIME);
  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_EXTRACTION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: STORES_SERIAL_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${resizedJpeg.toString('base64')}`,
                },
              },
            ],
          },
        ],
        max_tokens: VLM_MAX_TOKENS_OCR,
        temperature: VLM_TEMPERATURE,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`VLM ${response.status}`);
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseVlmSerialResponse(rawContent);
    if (!parsed?.serial) return null;
    const valid = validateSerialCandidate(parsed.serial);
    if (!valid) return null;
    // Generic-family values from the VLM are the most hallucination-prone.
    const confidence =
      valid.family === 'generic' ? Math.min(parsed.confidence, 0.5) : parsed.confidence;
    return { ...valid, confidence };
  } catch (err) {
    log.warn('serial extract: VLM call failed', { err }, 'my/stores/serials/extract');
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
