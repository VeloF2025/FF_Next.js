/**
 * QField Sync Start API Endpoint
 * Initiates a new sync job
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { log } from '@/lib/logger';
import { qfieldSyncService } from '@/modules/qfield-sync/services/qfieldSyncService';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { type = 'fiber_cables', direction = 'bidirectional' } = req.body;

  try {
    // Check if there's already a sync in progress
    const activeSync = await sql`
      SELECT id FROM qfield_sync_jobs
      WHERE status = 'syncing'
      LIMIT 1
    `;

    if (activeSync.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'A sync operation is already in progress',
      });
    }

    // Create new sync job
    const jobId = uuidv4();
    const job = {
      id: jobId,
      type,
      status: 'syncing',
      direction,
      startedAt: new Date().toISOString(),
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      errors: [],
    };

    // Insert job into database
    await sql`
      INSERT INTO qfield_sync_jobs (
        id, type, status, direction, started_at,
        records_processed, records_created, records_updated,
        records_failed, errors
      ) VALUES (
        ${job.id},
        ${job.type},
        ${job.status},
        ${job.direction},
        ${job.startedAt},
        ${job.recordsProcessed},
        ${job.recordsCreated},
        ${job.recordsUpdated},
        ${job.recordsFailed},
        ${JSON.stringify(job.errors)}
      )
    `;

    // Kick off real sync in the background — response returns immediately
    setImmediate(async () => {
      try {
        const result = await qfieldSyncService.startSync(
          type as 'fiber_cables' | 'poles' | 'splice_closures' | 'test_points',
          direction as 'qfield_to_fibreflow' | 'fibreflow_to_qfield' | 'bidirectional',
        );
        await sql`
          UPDATE qfield_sync_jobs SET
            status        = ${result.status},
            completed_at  = ${result.completedAt ?? new Date().toISOString()},
            records_processed = ${result.recordsProcessed},
            records_created   = ${result.recordsCreated},
            records_updated   = ${result.recordsUpdated},
            records_failed    = ${result.recordsFailed},
            duration_ms   = ${result.duration ?? 0},
            errors        = ${JSON.stringify(result.errors)}
          WHERE id = ${jobId}
        `;
        log.info('QField sync completed', { jobId, status: result.status, recordsProcessed: result.recordsProcessed });
      } catch (err) {
        log.error('QField background sync failed', { jobId, err });
        await sql`
          UPDATE qfield_sync_jobs SET
            status = 'error',
            completed_at = ${new Date().toISOString()},
            errors = ${JSON.stringify([{ message: err instanceof Error ? err.message : 'Sync failed' }])}
          WHERE id = ${jobId}
        `.catch(() => {/* best-effort */});
      }
    });

    return apiResponse.success(res, job, 'Sync job started successfully');

  } catch (error) {
    log.error('QField Sync Start API error', { error });

    return apiResponse.internalError(res, error);
  }
}




export default withAuth(handler);