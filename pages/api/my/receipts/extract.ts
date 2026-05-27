/**
 * POST /api/my/receipts/extract
 *
 * Multipart upload of a receipt photo. Server uploads original to VF
 * Storage at the permanent receipts path, then runs Qwen3-VL with the
 * closed-taxonomy RECEIPT_PROMPT and returns the parsed extraction.
 *
 * The response shape is what the review page needs to render: extraction
 * fields prefilled, the VLM's category guess, and the storedImageUrl
 * the subsequent /save call references. Save and Extract together are
 * the two-step flow — files only upload once.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import type { NextApiResponse } from 'next';
import formidable from 'formidable';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import {
  uploadReceiptAndExtract,
  type UploadAndExtractResult,
} from '@/modules/receipts/serverExtraction';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '12mb',
  },
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
]);

interface ExtractResponse {
  extractionId: string;
  imageUrl: string;
  imageMime: string;
  vlmSuccess: boolean;
  vendor: string | null;
  totalCents: number | null;
  vatCents: number | null;
  date: string | null;
  categoryGuess: string;
  lineItems: { description: string; amountCents: number | null }[];
  confidence: number;
}

function parseMultipart(
  req: import('next').NextApiRequest
): Promise<{ files: formidable.Files }> {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_FILE_BYTES,
    keepExtensions: true,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => {
      if (err) reject(err);
      else resolve({ files });
    });
  });
}

function pickFirst<T>(value: T | T[] | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  let parsed: { files: formidable.Files };
  try {
    parsed = await parseMultipart(req);
  } catch (err) {
    log.error('[my/receipts/extract] multipart parse failed', { err });
    return apiResponse.badRequest(res, 'Could not read upload — file too large or malformed.');
  }

  const file = pickFirst(parsed.files.photo) as formidable.File | undefined;
  if (!file) {
    return apiResponse.badRequest(res, 'Photo is required (form field "photo").');
  }

  const mime = file.mimetype || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    return apiResponse.badRequest(res, `Unsupported file type: ${mime}`);
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(file.filepath);
  } catch (err) {
    log.error('[my/receipts/extract] failed to read upload', { err });
    return apiResponse.internalError(res, 'Failed to read uploaded photo');
  } finally {
    fs.unlink(file.filepath).catch(() => undefined);
  }

  const extractionId = crypto.randomUUID();

  let result: UploadAndExtractResult;
  try {
    result = await uploadReceiptAndExtract({
      staffId: session.staffId,
      extractionId,
      fileBuffer: buffer,
      originalFilename: file.originalFilename ?? 'receipt',
      mime,
    });
  } catch (err) {
    log.error('[my/receipts/extract] upload+extract failed', {
      err,
      staffId: session.staffId,
      extractionId,
    });
    return apiResponse.internalError(res, 'Failed to upload and extract');
  }

  const response: ExtractResponse = {
    extractionId: result.extractionId,
    imageUrl: result.storedImageUrl,
    imageMime: result.storedImageMime,
    vlmSuccess: result.vlmSuccess,
    vendor: result.extraction.vendor,
    totalCents: result.extraction.totalCents,
    vatCents: result.extraction.vatCents,
    date: result.extraction.date,
    categoryGuess: result.extraction.categoryGuess,
    lineItems: result.extraction.lineItems.map((li) => ({
      description: li.description,
      amountCents: li.amountCents,
    })),
    confidence: result.extraction.confidence,
  };

  return apiResponse.success(res as NextApiResponse, response);
});
