import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';

/**
 * Database Query API Route - DISABLED
 *
 * This endpoint previously proxied arbitrary SQL queries to a backend server.
 * Disabled for security: arbitrary SQL execution is a critical risk even behind admin auth.
 * The backend API server (neon/api/server.ts) has been decommissioned.
 */
async function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  return res.status(410).json({
    success: false,
    error: 'This endpoint has been disabled for security reasons. Use specific API routes instead.',
  });
}

export default withAuth(withRole('admin')(handler));
