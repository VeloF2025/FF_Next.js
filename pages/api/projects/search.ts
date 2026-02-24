import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

/**
 * Projects Search API Route
 * GET /api/projects/search?q={query} - Search projects
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  try {
    // Get authentication from Clerk
    const userId = (req as AuthenticatedNextApiRequest).user.id;
    if (!userId) {
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Unauthorized');
    }

    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    // Proxy to backend API server
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/projects/search?q=${encodeURIComponent(q)}`, {
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
        error: error || `Failed to search projects: ${response.status}` 
      });
    }

    const result = await response.json();
    return apiResponse.success(res, result);
  } catch (error) {
    log.error('Project search error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
