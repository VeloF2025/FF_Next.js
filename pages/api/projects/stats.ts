import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

/**
 * Projects Statistics API Route
 * GET /api/projects/stats - Get project statistics
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const userId = (req as AuthenticatedNextApiRequest).user.id;
  if (!userId) {
    return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Unauthorized');
  }

  try {
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/analytics/projects/summary`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, errorText || `Backend error: ${response.status}`);
    }

    const result = await response.json();
    return apiResponse.success(res, result);
  } catch (error) {
    log.error(`Error fetching stats: ${error}`, undefined, 'ProjectStats');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
