import { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db/pool';

import { withAuth } from '@/lib/auth';
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Simple query to check if database is responsive
    const startTime = Date.now();
    await sql`SELECT 1`;
    const responseTime = Date.now() - startTime;

    return res.status(200).json({
      status: 'healthy',
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    
    return res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
}

export default withAuth(handler);