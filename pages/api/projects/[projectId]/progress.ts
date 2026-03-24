/**
 * API endpoint for project progress tracking
 * GET /api/projects/[projectId]/progress - Get project progress summary
 * POST /api/projects/[projectId]/progress - Update project progress
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { progressCalculations } from '@/services/projects/phases/neonPhaseService';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Authenticate user with Clerk
    if (!userId) {
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Unauthorized');
    }

    const projectId = req.query.projectId as string;

    if (!projectId) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    switch (req.method) {
      case 'GET':
        // Get project progress summary
        try {
          const progressSummary = await progressCalculations.getProjectProgressSummary(projectId);
          return apiResponse.success(res, progressSummary);
        } catch (error) {
          log.error('Error fetching project progress:', { data: error }, 'progress-api');
          return apiResponse.internalError(res, error);
        }

      case 'POST':
        // Recalculate and update project progress
        try {
          const { phaseId, stepId } = req.body;
          
          // Update progress at different levels based on what was provided
          if (stepId) {
            await progressCalculations.updateStepProgress(stepId);
          }
          
          if (phaseId) {
            await progressCalculations.updatePhaseProgress(phaseId);
          }
          
          // Always update project progress
          await progressCalculations.updateProjectProgress(projectId);
          
          // Return updated progress summary
          const progressSummary = await progressCalculations.getProjectProgressSummary(projectId);
          return apiResponse.success(res, {
            message: 'Progress updated successfully',
            summary: progressSummary
          });
        } catch (error) {
          log.error('Error updating project progress:', { data: error }, 'progress-api');
          return apiResponse.internalError(res, error);
        }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE']);
    }
  } catch (error) {
    log.error('API error:', { data: error }, 'progress-api');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
