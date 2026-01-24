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

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Authenticate user with Clerk
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const projectId = req.query.projectId as string;
    const phaseId = req.query.phaseId as string;

    if (!projectId || !phaseId) {
      return res.status(400).json({ error: 'Project ID and Phase ID are required' });
    }

    switch (req.method) {
      case 'GET':
        // Get phase details with steps and tasks
        try {
          const phase = await phaseOperations.getPhaseById(projectId, phaseId);
          if (!phase) {
            return res.status(404).json({ error: 'Phase not found' });
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
          
          return res.status(200).json({
            ...phase,
            steps: stepsWithTasks
          });
        } catch (error) {
          log.error('Error fetching phase details:', { data: error }, 'phase-api');
          return res.status(500).json({ error: 'Failed to fetch phase details' });
        }

      case 'PUT':
        // Update phase
        try {
          await phaseOperations.updatePhase(projectId, phaseId, req.body, userId);
          return res.status(200).json({ message: 'Phase updated successfully' });
        } catch (error) {
          log.error('Error updating phase:', { data: error }, 'phase-api');
          return res.status(500).json({ error: 'Failed to update phase' });
        }

      case 'DELETE':
        // Delete phase
        try {
          await phaseOperations.deletePhase(projectId, phaseId);
          return res.status(200).json({ message: 'Phase deleted successfully' });
        } catch (error) {
          log.error('Error deleting phase:', { data: error }, 'phase-api');
          return res.status(500).json({ error: 'Failed to delete phase' });
        }

      default:
        res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
  } catch (error) {
    log.error('API error:', { data: error }, 'phase-api');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler);
