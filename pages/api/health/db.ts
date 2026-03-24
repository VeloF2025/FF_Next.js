import { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db/pool';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
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
    log.error('Database health check failed', { error });

    return res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
}

export default withAuth(handler);