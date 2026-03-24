/**
 * API endpoint for managing project phases
 * GET /api/projects/[projectId]/phases - Get all phases for a project
 * POST /api/projects/[projectId]/phases - Create a new phase
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { phaseOperations, phaseGenerator } from '@/services/projects/phases/neonPhaseService';
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
        // Get all phases for a project
        try {
          const phases = await phaseOperations.getProjectPhases(projectId);
          return apiResponse.success(res, phases);
        } catch (error) {
          log.error('Error fetching project phases:', { data: error }, 'phases-api');
          return apiResponse.internalError(res, error);
        }

      case 'POST':
        // Create a new phase or generate default phases
        try {
          const { generateDefaults, ...phaseData } = req.body;
          
          if (generateDefaults) {
            // Generate default phases for the project
            await phaseGenerator.generateDefaultPhases(projectId, userId);
            const phases = await phaseOperations.getProjectPhases(projectId);
            return apiResponse.success(res, { 
              message: 'Default phases generated successfully',
              phases 
            });
          } else {
            // Create a single phase
            if (!phaseData.name) {
              return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
            }
            
            const phaseId = await phaseOperations.createPhase(projectId, phaseData, userId);
            return apiResponse.success(res, { 
              id: phaseId,
              message: 'Phase created successfully' 
            });
          }
        } catch (error) {
          log.error('Error creating phase:', { data: error }, 'phases-api');
          return apiResponse.internalError(res, error);
        }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE']);
    }
  } catch (error) {
    log.error('API error:', { data: error }, 'phases-api');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
