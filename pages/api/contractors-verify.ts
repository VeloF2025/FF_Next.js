/**
 * Contractor Verification API
 * GET: Fetch verification results for a contractor
 * POST: Trigger company verification (CIPC lookup)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { contractorVerificationService } from '@/services/contractor/contractorVerificationService';
import { log } from '@/lib/logger';
import type { VerificationBundle } from '@/types/contractor-verification.types';

const VALID_BUNDLES: VerificationBundle[] = ['basic', 'standard', 'enhanced', 'full_due_diligence'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as AuthenticatedNextApiRequest).user;

  if (req.method === 'GET') {
    try {
      const { contractorId } = req.query;
      if (!contractorId || typeof contractorId !== 'string') {
        return apiResponse.validationError(res, { contractorId: 'Required' });
      }

      const results = await contractorVerificationService.getVerificationResults(contractorId);
      return apiResponse.success(res, results);
    } catch (error) {
      log.error('Failed to fetch verification results', { error }, 'contractors-verify');
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const { contractorId, bundle } = req.body;

      if (!contractorId || typeof contractorId !== 'string') {
        return apiResponse.validationError(res, { contractorId: 'Required' });
      }
      if (!bundle || !VALID_BUNDLES.includes(bundle)) {
        return apiResponse.validationError(res, { bundle: `Must be one of: ${VALID_BUNDLES.join(', ')}` });
      }

      const results = await contractorVerificationService.verifyCompany(
        contractorId,
        bundle as VerificationBundle,
        user.name || user.email
      );

      return apiResponse.success(res, results, 'Company verification complete');
    } catch (error) {
      log.error('Company verification failed', { error }, 'contractors-verify');
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
