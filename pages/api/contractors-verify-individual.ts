/**
 * Individual Verification API
 * POST: Trigger an individual check (ID photo, criminal, PEP/sanctions)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { contractorVerificationService } from '@/services/contractor/contractorVerificationService';
import { log } from '@/lib/logger';
import type { VerificationType } from '@/types/contractor-verification.types';

const VALID_TYPES: VerificationType[] = [
  'id_verification', 'id_photo', 'criminal_record', 'pep_sanctions',
  'qualification', 'drivers_license', 'adverse_news',
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const user = (req as AuthenticatedNextApiRequest).user;

  try {
    const { contractorId, directorId, checkType } = req.body;

    if (!contractorId || typeof contractorId !== 'string') {
      return apiResponse.validationError(res, { contractorId: 'Required' });
    }
    if (!directorId || typeof directorId !== 'string') {
      return apiResponse.validationError(res, { directorId: 'Required' });
    }
    if (!checkType || !VALID_TYPES.includes(checkType)) {
      return apiResponse.validationError(res, { checkType: `Must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const result = await contractorVerificationService.verifyIndividual(
      contractorId,
      directorId,
      checkType as VerificationType,
      user.name || user.email
    );

    return apiResponse.success(res, result, 'Individual check complete');
  } catch (error) {
    log.error('Individual verification failed', { error }, 'contractors-verify-individual');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
