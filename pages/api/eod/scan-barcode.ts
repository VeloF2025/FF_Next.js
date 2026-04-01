/**
 * EOD Barcode Scan API
 * POST: Scan a single barcode sticker photo and return the ONT serial
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { scanBarcodeEnhanced, extractOntSerialEnhanced } from '@/modules/activate/services/enhancedBarcodeService';
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
    // Try ONT-specific extraction first (best for Nokia stickers)
    const ontResult = await extractOntSerialEnhanced(image);
    if (ontResult.success && ontResult.serial) {
      return apiResponse.success(res, {
        serial: ontResult.serial,
        confidence: ontResult.confidence,
        method: ontResult.method,
      });
    }

    // Fallback: generic barcode scan
    const barcodeResult = await scanBarcodeEnhanced(image);
    if (barcodeResult.success && barcodeResult.value) {
      return apiResponse.success(res, {
        serial: barcodeResult.value,
        confidence: barcodeResult.confidence,
        method: barcodeResult.method,
      });
    }

    return apiResponse.success(res, {
      serial: null,
      confidence: 0,
      method: null,
      error: 'No barcode detected — try holding the camera closer to the sticker',
    });
  } catch (err) {
    log.error('[EOD-Barcode] Scan error', { error: err });
    return apiResponse.error(res, 'Barcode scan failed', 500);
  }
}

export default withAuth(handler);

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};
