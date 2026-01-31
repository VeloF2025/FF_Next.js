import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

/**
 * SOW Import Status API Route
 * GET /api/sow/import/[importId]/status - Get import status
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { importId } = req.query;

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authentication from Clerk
    const userId = (req as AuthenticatedNextApiRequest).user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!importId || typeof importId !== 'string') {
      return res.status(400).json({ error: 'Import ID is required' });
    }

    // Proxy to backend API server
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/sow/import-status?importId=${importId}`, {
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
        status: 'error',
        error: error || `Failed to get import status: ${response.status}` 
      });
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch (error) {
    console.error('Import status error:', error);
    return res.status(500).json({ 
      success: false,
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to get import status' 
    });
  }
}

export default withAuth(handler);
