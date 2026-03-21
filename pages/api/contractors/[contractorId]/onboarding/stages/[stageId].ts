/**
 * Contractor Onboarding Stage API
 * PUT /api/contractors/[contractorId]/onboarding/stages/[stageId]
 * Update a specific onboarding stage
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { contractorOnboardingService, UpdateStageRequest } from '@/services/contractor/contractorOnboardingService';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId, stageId } = req.query;

  // Validate IDs
  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.validationError(res, { contractorId: 'Invalid contractor ID' });
  }

  if (!stageId || typeof stageId !== 'string') {
    return apiResponse.validationError(res, { stageId: 'Invalid stage ID' });
  }

  if (req.method === 'PUT') {
    try {
      // Check if contractor exists
      const [contractor] = await sql`SELECT id FROM contractors WHERE id = ${contractorId}`;
      if (!contractor) {
        return apiResponse.notFound(res, 'Contractor', contractorId);
      }

      // Check if stage exists
      const stage = await contractorOnboardingService.getStageById(Number(stageId));
      if (!stage) {
        return apiResponse.notFound(res, 'Onboarding stage', stageId);
      }

      // Verify stage belongs to contractor
      if (stage.contractorId.toString() !== contractorId.toString()) {
        return apiResponse.validationError(res, {
          stageId: 'Stage does not belong to this contractor',
        });
      }

      // Parse and validate request body
      const updates: UpdateStageRequest = req.body;

      if (updates.status && !['pending', 'in_progress', 'completed', 'skipped'].includes(updates.status)) {
        return apiResponse.validationError(res, {
          status: 'Invalid status value',
        });
      }

      if (updates.completionPercentage !== undefined) {
        if (updates.completionPercentage < 0 || updates.completionPercentage > 100) {
          return apiResponse.validationError(res, {
            completionPercentage: 'Must be between 0 and 100',
          });
        }
      }

      // Update stage
      const updatedStage = await contractorOnboardingService.updateStage(
        Number(stageId),
        updates
      );

      // Update contractor's overall onboarding progress
      const progress = await contractorOnboardingService.getOnboardingProgress(contractorId);
      await sql`
        UPDATE contractors
        SET onboarding_progress = ${progress.overallProgress}
        WHERE id = ${contractorId}
      `;

      return apiResponse.success(res, updatedStage, 'Stage updated successfully');
    } catch (error: any) {
      return apiResponse.internalError(res, error);
    }
  }

  // Method not allowed
  res.setHeader('Allow', ['PUT']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}

export default withAuth(handler);
