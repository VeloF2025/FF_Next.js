/**
 * POST /api/assets/extract-from-image
 *
 * Accepts a base64-encoded image and uses VLM to extract asset label info.
 * Called by LabelScanner component in extract mode.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { extractAssetFromLabel } from '@/modules/assets/services/assetVlmService';
import { log } from '@/lib/logger';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 is required',
      });
    }

    const extraction = await extractAssetFromLabel(imageBase64);

    if (!extraction.success) {
      return res.status(422).json({
        success: false,
        error: extraction.error || 'Extraction failed',
      });
    }

    return res.status(200).json({
      success: true,
      extraction,
    });
  } catch (error) {
    log.error('[API] extract-from-image failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}
