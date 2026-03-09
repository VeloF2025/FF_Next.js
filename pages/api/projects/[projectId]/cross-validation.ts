/**
 * Document Cross-Validation API
 * GET  /api/projects/[projectId]/cross-validation - Get latest result
 * POST /api/projects/[projectId]/cross-validation - Trigger re-validation
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import {
  runCrossValidationIfReady,
  getLatestValidation,
} from '@/modules/projects/services/documentCrossValidationService';

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const projectId = req.query.projectId as string;
  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  if (req.method === 'GET') {
    const validation = await getLatestValidation(projectId);
    if (!validation) {
      return apiResponse.success(res, {
        hasValidation: false,
        message: 'No cross-validation result yet — upload PO, BSS, and MSS first',
      });
    }

    return apiResponse.success(res, {
      hasValidation: true,
      validation: {
        id: validation.id,
        status: validation.status,
        isValid: validation.is_valid,
        discrepancies: validation.discrepancies,
        confidenceScore: Number(validation.confidence_score),
        po: {
          drops: validation.po_drops,
          pricePerDrop: Number(validation.po_price_per_drop),
          totalValue: Number(validation.po_total_value),
        },
        bss: {
          drops: validation.bss_drops,
          pricePerDrop: Number(validation.bss_price_per_drop),
          totalValue: Number(validation.bss_total_value),
        },
        mss: {
          drops: validation.mss_drops,
          pricePerDrop: Number(validation.mss_price_per_drop),
          totalValue: Number(validation.mss_total_value),
        },
        validatedAt: validation.validated_at,
      },
    });
  }

  if (req.method === 'POST') {
    log.info('Manual cross-validation triggered', { projectId }, 'DocCrossVal');
    const result = await runCrossValidationIfReady(projectId);

    if (!result) {
      return apiResponse.badRequest(res, 'Cannot run cross-validation — ensure PO, BSS, and MSS are all uploaded');
    }

    return apiResponse.success(res, {
      status: result.status,
      isValid: result.isValid,
      discrepancies: result.discrepancies,
      confidenceScore: result.confidenceScore,
    });
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}));
