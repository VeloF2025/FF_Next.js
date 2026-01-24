/**
 * API: Extract Vehicle Details from Licence Disk Photo
 * POST /api/fleet/vehicles/extract-license-disk
 *
 * Uses Qwen3-VL-8B-Instruct to OCR licence disk and extract vehicle details
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { extractLicenseDiskDetails } from '@/modules/fleet/services/fleetVlmService';
import type { LicenseDiskExtractionResult } from '@/modules/fleet/types/check-in.types';
import { withAuth } from '@/lib/auth';

const MODULE = 'fleet:api:extract-license-disk';

interface ExtractLicenseDiskRequest {
  image: string; // Base64-encoded image
}

interface ExtractLicenseDiskResponse {
  success: boolean;
  data?: LicenseDiskExtractionResult;
  error?: string;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Allow larger images
    },
  },
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExtractLicenseDiskResponse>
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { image } = req.body as ExtractLicenseDiskRequest;

    if (!image) {
      return apiResponse.validationError(res, { image: 'Image is required' });
    }

    // Strip data URL prefix if present
    const base64Image = image.replace(/^data:image\/[a-z]+;base64,/, '');

    log.info(MODULE, 'Processing licence disk image...');

    const result = await extractLicenseDiskDetails(base64Image);

    if (result.error) {
      log.warn(MODULE, `Extraction completed with error: ${result.error}`);
    } else {
      log.info(MODULE, `Extraction successful, confidence: ${result.confidence}`);
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    log.error(MODULE, `Failed to extract licence disk details: ${error}`);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
