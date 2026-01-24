import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../../lib/auth-mock';
import { withAuth } from '@/lib/auth';

/**
 * SOW Tables Check API Route
 * GET /api/sow/tables/check - Check if SOW tables exist
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authentication from Clerk
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Proxy to backend API server
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/sow/health`, {
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
        error: error || `Failed to check SOW tables: ${response.status}` 
      });
    }

    const result = await response.json();
    return res.status(200).json({
      success: result.success,
      tables: result.tables || [],
      error: result.error,
    });
  } catch (error) {
    console.error('SOW tables check error:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check SOW tables' 
    });
  }
}

export default withAuth(handler);
