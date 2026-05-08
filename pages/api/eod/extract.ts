/**
 * EOD Sheet VLM Extraction API
 * POST: Extract data from an EOD install sheet photo using VLM.
 *       If photoHash is provided and matches an existing sheet, returns a duplicate
 *       sentinel instead of calling VLM (saves the expensive inference call).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { extractEodSheet } from '@/modules/data-sync/services/eodVlmService';
import { findSheetByHash } from '@/modules/data-sync/services/eodSheetService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const { image, photoHash } = req.body;
  if (!image || typeof image !== 'string') {
    return apiResponse.badRequest(res, 'Missing image (base64 string)');
  }

  // Check for duplicate before calling VLM — saves the expensive inference
  if (photoHash && typeof photoHash === 'string') {
    try {
      const existing = await findSheetByHash(photoHash);
      if (existing) {
        log.info('[EOD-Extract] Duplicate detected by hash', { photoHash, existingId: existing.id });
        return apiResponse.success(res, {
          duplicate: true,
          existingSheetId: existing.id,
          existingSheetDate: existing.sheet_date,
        });
      }
    } catch (err) {
      // Non-fatal — fall through to VLM if hash check fails
      log.warn('[EOD-Extract] Hash check failed, proceeding with VLM', { error: err });
    }
  }

  try {
    const result = await extractEodSheet(image);

    if (!result.success) {
      return apiResponse.internalError(res, new Error(result.error || 'VLM extraction failed'));
    }

    return apiResponse.success(res, { duplicate: false, ...result.data });
  } catch (err) {
    log.error('[EOD-Extract] Unexpected error', { error: err });
    return apiResponse.internalError(res, err, 'Extraction failed');
  }
}

export default withAuth(handler);

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};
