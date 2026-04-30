/**
 * Server-side receipt OCR — uploads the captured image to VF Storage
 * (permanent path so saving the row doesn't require a second upload),
 * runs Qwen3-VL with the closed-taxonomy RECEIPT_PROMPT, parses the
 * response.
 *
 * Mirrors the fleet fuelExtractor pattern but generalised for any
 * receipt type. Uses the existing VLM endpoint configuration from
 * src/lib/vlm/config.ts so future model swaps are env-flag-only.
 */

import sharp from 'sharp';

import { log } from '@/lib/logger';
import { vfStorage } from '@/services/vfStorageAdapter';
import { VLM_CHAT_ENDPOINT, VLM_MODEL } from '@/lib/vlm/config';

import { RECEIPT_PROMPT, parseReceiptVlmResponse, type ReceiptExtraction } from './extraction';

const VF_STORAGE_INTERNAL_URL =
  process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

const VLM_TIMEOUT_MS = 90_000;
const VLM_MAX_TOKENS = 1500;

const MAX_VLM_IMAGE_WIDTH = 1280;
const MAX_VLM_IMAGE_HEIGHT = 1280;

export interface UploadAndExtractArgs {
  staffId: string;
  /** Pre-generated UUID — used as the storage filename + DB row PK. */
  extractionId: string;
  /** Original file from the multipart upload. */
  fileBuffer: Buffer;
  /** Original filename (for extension detection only). */
  originalFilename: string;
  /** MIME from the upload — preserved on the saved row. */
  mime: string;
}

export interface UploadAndExtractResult {
  extractionId: string;
  /** VF Storage relative path (/storage/...) — what we persist on the row. */
  storedImageUrl: string;
  /** MIME we recorded for the row. */
  storedImageMime: string;
  /** Parsed extraction (vendor, total, date, categoryGuess, line items). */
  extraction: ReceiptExtraction;
  /** True if the VLM succeeded; false if we caught a VLM-side error. */
  vlmSuccess: boolean;
}

/**
 * Resize the captured image to fit within VLM token limits without
 * changing aspect ratio. Output is JPEG (smaller than PNG, lossy is
 * fine for receipt OCR). Returns a fresh Buffer.
 */
async function resizeForVlm(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const needsResize = w > MAX_VLM_IMAGE_WIDTH || h > MAX_VLM_IMAGE_HEIGHT;

  let pipeline = sharp(buffer);
  if (needsResize) {
    pipeline = pipeline.resize({
      width: MAX_VLM_IMAGE_WIDTH,
      height: MAX_VLM_IMAGE_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  return pipeline.jpeg({ quality: 88 }).toBuffer();
}

function pickStorageExt(filename: string, mime: string): string {
  if (mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'jpg';
}

export async function uploadReceiptAndExtract(
  args: UploadAndExtractArgs
): Promise<UploadAndExtractResult> {
  const ext = pickStorageExt(args.originalFilename, args.mime);
  // Flat category so VF Storage's single-level `staff/<category>/<filename>`
  // path holds. Staff identity is encoded in the filename instead of a
  // sub-folder — mirrors the payslips upload pattern.
  const filename = `${args.staffId}__${args.extractionId}.${ext}`;

  // 1. Resize for VLM ingestion (only the image variant — PDFs are passed
  //    through as-is; the existing imageProcessingService converts PDFs to
  //    images for OCR but we'll defer that to a follow-up since most
  //    receipts photographed on phone are JPEGs).
  let storageBuffer = args.fileBuffer;
  if (ext === 'jpg') {
    try {
      storageBuffer = await resizeForVlm(args.fileBuffer);
    } catch (err) {
      log.warn('[receipts] resize failed; uploading original', { err });
      storageBuffer = args.fileBuffer;
    }
  }

  // 2. Permanent upload. Storage path is staff/<staffId>/receipts/<uuid>.<ext>.
  //    If the user abandons review without saving the row, the blob is
  //    orphaned — Phase 2 GC cron will sweep blobs that have no
  //    matching staff_receipts row after 24h.
  const uploadResult = await vfStorage.uploadFile(
    storageBuffer,
    'staff',
    'receipts',
    filename
  );

  const storedImageUrl = uploadResult.url; // /storage/staff/<id>/receipts/<file>
  const storedImageMime = ext === 'pdf' ? 'application/pdf' : 'image/jpeg';

  // 3. VLM call. Convert relative URL to internal-fetchable URL since the
  //    VLM service runs on the internal network.
  let internalUrl = storedImageUrl;
  if (internalUrl.startsWith('/storage/')) {
    internalUrl = `${VF_STORAGE_INTERNAL_URL}${internalUrl.replace(/^\/storage/, '')}`;
  }

  let extraction: ReceiptExtraction;
  let vlmSuccess = true;

  try {
    const vlmResponse = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: RECEIPT_PROMPT },
              { type: 'image_url', image_url: { url: internalUrl } },
            ],
          },
        ],
        max_tokens: VLM_MAX_TOKENS,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(VLM_TIMEOUT_MS),
    });

    if (!vlmResponse.ok) {
      const body = await vlmResponse.text();
      throw new Error(`VLM HTTP ${vlmResponse.status}: ${body.slice(0, 200)}`);
    }

    const vlmData = (await vlmResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = vlmData.choices?.[0]?.message?.content ?? '';
    extraction = parseReceiptVlmResponse(extractJsonObject(content));
  } catch (err) {
    log.error('[receipts] VLM extraction failed', { err, extractionId: args.extractionId });
    vlmSuccess = false;
    extraction = parseReceiptVlmResponse({});
  }

  return {
    extractionId: args.extractionId,
    storedImageUrl,
    storedImageMime,
    extraction,
    vlmSuccess,
  };
}

function extractJsonObject(rawContent: string): unknown {
  if (!rawContent) return {};
  // Qwen3 sometimes wraps JSON in prose; grab the largest brace-balanced object.
  const match = rawContent.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    log.warn('[receipts] failed to parse VLM JSON; using empty extraction', {
      snippet: rawContent.slice(0, 300),
      err: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
