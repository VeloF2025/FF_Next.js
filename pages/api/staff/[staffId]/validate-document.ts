/**
 * Staff Document Validation API
 * POST: Validate OCR data against staff record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { validateDocument } from '@/services/staff/documentValidationService';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { staffId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return apiResponse.badRequest(res, 'Staff ID is required');
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  try {
    const { documentType, ocrData } = req.body;

    if (!documentType) {
      return apiResponse.badRequest(res, 'Document type is required');
    }

    if (!ocrData || typeof ocrData !== 'object') {
      return apiResponse.badRequest(res, 'OCR data is required');
    }

    log.info('Validating document against staff record', { staffId, documentType });

    const validation = await validateDocument(staffId, documentType, ocrData);

    log.info('Document validation completed', {
      staffId,
      documentType,
      isValid: validation.isValid,
      matchScore: validation.matchScore,
      mismatches: validation.mismatches.length,
      matches: validation.matches.length,
    });

    return apiResponse.success(res, { validation });
  } catch (error: any) {
    log.error('Document validation API error', { staffId, method: req.method, error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
