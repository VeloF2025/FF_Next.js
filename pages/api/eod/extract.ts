/**
 * EOD Sheet VLM Extraction API
 * POST: Extract data from an EOD install sheet photo using VLM
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/withAuth';
import { apiResponse } from '@/lib/apiResponse';
import { extractEodSheet } from '@/modules/data-sync/services/eodVlmService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || '');
  }

  const { image } = req.body;
  if (!image || typeof image !== 'string') {
    return apiResponse.badRequest(res, 'Missing image (base64 string)');
  }

  try {
    const result = await extractEodSheet(image);

    if (!result.success) {
      return apiResponse.error(res, result.error || 'VLM extraction failed', 500);
    }

    return apiResponse.success(res, result.data);
  } catch (err) {
    log.error('[EOD-Extract] Unexpected error', { error: err });
    return apiResponse.error(res, 'Extraction failed', 500);
  }
}

export default withAuth(handler);

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};
