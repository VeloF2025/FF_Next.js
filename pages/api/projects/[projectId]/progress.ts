/**
 * API endpoint for project progress tracking
 * GET /api/projects/[projectId]/progress - Get project progress summary
 * POST /api/projects/[projectId]/progress - Update project progress
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { progressCalculations } from '@/services/projects/phases/neonPhaseService';
import { log } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Authenticate user with Clerk
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const projectId = req.query.projectId as string;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    switch (req.method) {
      case 'GET':
        // Get project progress summary
        try {
          const progressSummary = await progressCalculations.getProjectProgressSummary(projectId);
          return res.status(200).json(progressSummary);
        } catch (error) {
          log.error('Error fetching project progress:', { data: error }, 'progress-api');
          return res.status(500).json({ error: 'Failed to fetch project progress' });
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
          return res.status(200).json({
            message: 'Progress updated successfully',
            summary: progressSummary
          });
        } catch (error) {
          log.error('Error updating project progress:', { data: error }, 'progress-api');
          return res.status(500).json({ error: 'Failed to update project progress' });
        }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
  } catch (error) {
    log.error('API error:', { data: error }, 'progress-api');
    return res.status(500).json({ error: 'Internal server error' });
  }
}