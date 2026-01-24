/**
 * QField Sync Current Job API Endpoint
 * Returns the current active sync job if any
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

  try {
    // Check if there's an active sync job in the database
    const result = await sql`
      SELECT
        id, type, status, direction, started_at,
        records_processed, records_created, records_updated,
        records_failed, errors
      FROM qfield_sync_jobs
      WHERE status = 'syncing'
      ORDER BY started_at DESC
      LIMIT 1
    `;

    const currentJob = result[0] || null;

    if (currentJob) {
      // Format the response with null checks
      const formattedJob = {
        id: currentJob.id || 'unknown',
        type: currentJob.type || 'fiber_cables',
        status: currentJob.status || 'syncing',
        direction: currentJob.direction || 'bidirectional',
        startedAt: currentJob.started_at || new Date().toISOString(),
        recordsProcessed: currentJob.records_processed || 0,
        recordsCreated: currentJob.records_created || 0,
        recordsUpdated: currentJob.records_updated || 0,
        recordsFailed: currentJob.records_failed || 0,
        errors: currentJob.errors || [],
      };

      return apiResponse.success(res, formattedJob, 'Current job retrieved');
    }

    return apiResponse.success(res, null, 'No active sync job');

  } catch (error) {
    console.error('QField Sync Current Job API error:', error);

    // Check if the error is because the table doesn't exist
    if (error instanceof Error && error.message.includes('does not exist')) {
      // Table doesn't exist yet, return null
      return apiResponse.success(res, null, 'No sync jobs table yet');
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);