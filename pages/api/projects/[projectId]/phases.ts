/**
 * API endpoint for managing project phases
 * GET /api/projects/[projectId]/phases - Get all phases for a project
 * POST /api/projects/[projectId]/phases - Create a new phase
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { phaseOperations, phaseGenerator } from '@/services/projects/phases/neonPhaseService';
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

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    switch (req.method) {
      case 'GET':
        // Get all phases for a project
        try {
          const phases = await phaseOperations.getProjectPhases(projectId);
          return res.status(200).json(phases);
        } catch (error) {
          log.error('Error fetching project phases:', { data: error }, 'phases-api');
          return res.status(500).json({ error: 'Failed to fetch project phases' });
        }

      case 'POST':
        // Create a new phase or generate default phases
        try {
          const { generateDefaults, ...phaseData } = req.body;
          
          if (generateDefaults) {
            // Generate default phases for the project
            await phaseGenerator.generateDefaultPhases(projectId, userId);
            const phases = await phaseOperations.getProjectPhases(projectId);
            return res.status(201).json({ 
              message: 'Default phases generated successfully',
              phases 
            });
          } else {
            // Create a single phase
            if (!phaseData.name) {
              return res.status(400).json({ error: 'Phase name is required' });
            }
            
            const phaseId = await phaseOperations.createPhase(projectId, phaseData, userId);
            return res.status(201).json({ 
              id: phaseId,
              message: 'Phase created successfully' 
            });
          }
        } catch (error) {
          log.error('Error creating phase:', { data: error }, 'phases-api');
          return res.status(500).json({ error: 'Failed to create phase' });
        }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
  } catch (error) {
    log.error('API error:', { data: error }, 'phases-api');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler);
