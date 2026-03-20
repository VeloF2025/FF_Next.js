/**
 * Contractor Onboarding Complete API
 * POST /api/contractors/[contractorId]/onboarding/complete
 * Mark contractor onboarding as complete
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { contractorOnboardingService } from '@/services/contractor/contractorOnboardingService';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  // Validate contractorId
  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.validationError(res, { contractorId: 'Invalid contractor ID' });
  }

  if (req.method === 'POST') {
    try {
      // Check if contractor exists
      const [contractor] = await sql`SELECT * FROM contractors WHERE id = ${contractorId}`;
      if (!contractor) {
        return apiResponse.notFound(res, 'Contractor', contractorId);
      }

      // Check if onboarding is actually complete
      const progress = await contractorOnboardingService.getOnboardingProgress(contractorId);

      if (!progress.isComplete) {
        return apiResponse.validationError(res, {
          onboarding: `Cannot complete onboarding. ${progress.completedStages}/${progress.totalStages} stages completed.`,
        });
      }

      // Complete onboarding
      await contractorOnboardingService.completeOnboarding(contractorId);

      // Get updated contractor
      const [updatedContractor] = await sql`SELECT * FROM contractors WHERE id = ${contractorId}`;

      return apiResponse.success(
        res,
        {
          contractor: updatedContractor,
          onboardingProgress: progress,
        },
        'Onboarding completed successfully'
      );
    } catch (error: any) {
      return apiResponse.internalError(res, error);
    }
  }

  // Method not allowed
  res.setHeader('Allow', ['POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}

export default withAuth(handler);
