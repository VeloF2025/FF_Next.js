/**
 * Contractor Onboarding Stages API
 * GET /api/contractors/[contractorId]/onboarding/stages
 * Returns all onboarding stages for a contractor
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

  if (req.method === 'GET') {
    try {
      // Check if contractor exists
      const [contractor] = await sql`SELECT id FROM contractors WHERE id = ${contractorId}`;
      if (!contractor) {
        return apiResponse.notFound(res, 'Contractor', contractorId);
      }

      // Get or initialize onboarding stages
      let stages = await contractorOnboardingService.getOnboardingStages(contractorId);

      // If no stages exist, initialize them
      if (stages.length === 0) {
        stages = await contractorOnboardingService.initializeOnboarding(contractorId);
      }

      return apiResponse.success(res, stages);
    } catch (error: any) {
      return apiResponse.internalError(res, error);
    }
  }

  // Method not allowed
  res.setHeader('Allow', ['GET']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}

export default withAuth(handler);
