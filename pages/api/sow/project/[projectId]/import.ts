import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../../../lib/auth-mock';
import { withAuth } from '@/lib/auth';

/**
 * SOW Import API Route
 * POST /api/sow/project/[projectId]/import - Import SOW data for a project
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { projectId } = req.query;

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authentication from Clerk
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    // Proxy to backend API server
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/sow/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
      },
      body: JSON.stringify({
        projectId,
        ...req.body,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ 
        success: false,
        error: error || `Failed to import SOW data: ${response.status}` 
      });
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch (error) {
    console.error('SOW import error:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import SOW data' 
    });
  }
}

export default withAuth(handler);
