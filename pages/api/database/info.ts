import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
/**
 * Database Info API Route
 * Gets database version and connection information
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    // Proxy to backend API server
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        success: false,
        connected: false,
        error: `Backend connection failed: ${response.status}` 
      });
    }

    const result = await response.json();
    return res.status(200).json({
      success: result.success,
      connected: result.success === true,
      version: result.version || 'Unknown',
      error: result.error,
    });
  } catch (error) {
    log.error('Database info error', { error });
    return res.status(500).json({ 
      success: false,
      connected: false,
      error: error instanceof Error ? error.message : 'Failed to get database info' 
    });
  }
}

export default withAuth(withRole('admin')(handler));