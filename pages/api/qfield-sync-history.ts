/**
 * QField Sync History API Endpoint
 * Returns paginated sync job history
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { getAuth } from '../../lib/auth-mock';
import { apiResponse } from '@/lib/apiResponse';

import { withAuth } from '@/lib/auth';
const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { userId } = getAuth(req);

  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { page = '1', pageSize = '20' } = req.query;
  const pageNum = parseInt(page as string);
  const size = parseInt(pageSize as string);
  const offset = (pageNum - 1) * size;

  try {
    // Get total count
    const countResult = await sql`
      SELECT COUNT(*) as total
      FROM qfield_sync_jobs
      WHERE status IN ('completed', 'error')
    `;
    const totalCount = parseInt(countResult[0]?.total || '0');

    // Get paginated jobs
    const jobs = await sql`
      SELECT
        id, type, status, direction, started_at, completed_at,
        records_processed, records_created, records_updated,
        records_failed, duration_ms, errors
      FROM qfield_sync_jobs
      WHERE status IN ('completed', 'error')
      ORDER BY started_at DESC
      LIMIT ${size}
      OFFSET ${offset}
    `;

    // Format the jobs with null checks
    const formattedJobs = jobs.map(job => ({
      id: job.id || 'unknown',
      type: job.type || 'fiber_cables',
      status: job.status || 'completed',
      direction: job.direction || 'bidirectional',
      startedAt: job.started_at || new Date().toISOString(),
      completedAt: job.completed_at || null,
      recordsProcessed: job.records_processed || 0,
      recordsCreated: job.records_created || 0,
      recordsUpdated: job.records_updated || 0,
      recordsFailed: job.records_failed || 0,
      duration: job.duration_ms || 0,
      errors: job.errors || [],
    }));

    const response = {
      jobs: formattedJobs,
      totalCount,
      page: pageNum,
      pageSize: size,
    };

    return apiResponse.success(res, response, 'Sync history retrieved');

  } catch (error) {
    console.error('QField Sync History API error:', error);

    // Check if the error is because the table doesn't exist
    if (error instanceof Error && error.message.includes('does not exist')) {
      // Return empty history
      const emptyResponse = {
        jobs: [],
        totalCount: 0,
        page: pageNum,
        pageSize: size,
      };
      return apiResponse.success(res, emptyResponse, 'No sync history yet');
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);