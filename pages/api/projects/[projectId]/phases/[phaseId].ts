/**
 * API endpoint for managing a specific project phase
 * GET /api/projects/[projectId]/phases/[phaseId] - Get phase details
 * PUT /api/projects/[projectId]/phases/[phaseId] - Update phase
 * DELETE /api/projects/[projectId]/phases/[phaseId] - Delete phase
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { phaseOperations, stepOperations, taskOperations } from '@/services/projects/phases/neonPhaseService';
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
    const phaseId = req.query.phaseId as string;

    if (!projectId || !phaseId) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    switch (req.method) {
      case 'GET':
        // Get phase details with steps and tasks
        try {
          const phase = await phaseOperations.getPhaseById(projectId, phaseId);
          if (!phase) {
            return apiResponse.error(res, ErrorCode.NOT_FOUND, 'Not found');
          }
          
          // Get steps for this phase
          const steps = await stepOperations.getPhaseSteps(phaseId);
          
          // Get tasks for each step
          const stepsWithTasks = await Promise.all(
            steps.map(async (step) => {
              const tasks = await taskOperations.getStepTasks(step.id);
              return { ...step, tasks };
            })
          );
          
          return apiResponse.success(res, {
            ...phase,
            steps: stepsWithTasks
          });
        } catch (error) {
          log.error('Error fetching phase details:', { data: error }, 'phase-api');
          return apiResponse.internalError(res, error);
        }

      case 'PUT':
        // Update phase
        try {
          await phaseOperations.updatePhase(projectId, phaseId, req.body, userId);
          return apiResponse.success(res, { message: 'Phase updated successfully' });
        } catch (error) {
          log.error('Error updating phase:', { data: error }, 'phase-api');
          return apiResponse.internalError(res, error);
        }

      case 'DELETE':
        // Delete phase
        try {
          await phaseOperations.deletePhase(projectId, phaseId);
          return apiResponse.success(res, { message: 'Phase deleted successfully' });
        } catch (error) {
          log.error('Error deleting phase:', { data: error }, 'phase-api');
          return apiResponse.internalError(res, error);
        }

      default:
        res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE']);
    }
  } catch (error) {
    log.error('API error:', { data: error }, 'phase-api');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
