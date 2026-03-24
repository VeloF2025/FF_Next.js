import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

/**
 * SOW Poles with Drops API Route
 * GET /api/sow/project/[projectId]/poles-with-drops - Get poles with drop count
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { projectId } = req.query;

  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    // Get authentication from Clerk
    const userId = (req as AuthenticatedNextApiRequest).user.id;
    if (!userId) {
      return apiResponse.unauthorized(res);
    }

    if (!projectId || typeof projectId !== 'string') {
      return apiResponse.badRequest(res, 'Project ID is required');
    }

    // Proxy to backend API server
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/sow/poles?projectId=${projectId}&includeDropCount=true`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ 
        success: false,
        error: error || `Failed to fetch poles with drops: ${response.status}` 
      });
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch (error) {
    log.error('SOW poles with drops error', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch poles with drops'
    });
  }
}

export default withAuth(handler);
