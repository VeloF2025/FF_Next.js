/**
 * POST /api/construction-qa/sp-sync
 *
 * Batch worker — syncs approved civil QA reviews to SharePoint.
 * Processes up to 20 pending reviews per call (prevents timeout).
 *
 * Body (all optional):
 *   { projectId?: string, reviewId?: string }
 *   No body → process ALL pending reviews
 *
 * Auth: super_admin only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { syncReview } from '@/modules/construction-qa/services/sharepointSyncService';

const sql = neon(process.env.DATABASE_URL!);
const BATCH_SIZE = 20;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  const { projectId, reviewId } = (req.body ?? {}) as {
    projectId?: string;
    reviewId?: string;
  };

  const spProjectId = process.env.SHAREPOINT_QA_PROJECT_ID;

  try {
    let pending: { id: string }[];

    if (reviewId) {
      pending = (await sql`
        SELECT id FROM construction_qa_reviews
        WHERE id = ${reviewId}::uuid
          AND sp_sync_status = 'pending'
          AND (${spProjectId ?? ''}::text = '' OR project_id::text = ${spProjectId ?? ''})
        LIMIT 1
      `) as unknown as { id: string }[];
    } else if (projectId) {
      pending = (await sql`
        SELECT id FROM construction_qa_reviews
        WHERE project_id = ${projectId}::uuid
          AND sp_sync_status = 'pending'
        ORDER BY updated_at ASC
        LIMIT ${BATCH_SIZE}
      `) as unknown as { id: string }[];
    } else {
      pending = (await sql`
        SELECT id FROM construction_qa_reviews
        WHERE sp_sync_status = 'pending'
          AND (${spProjectId ?? ''}::text = '' OR project_id::text = ${spProjectId ?? ''})
        ORDER BY updated_at ASC
        LIMIT ${BATCH_SIZE}
      `) as unknown as { id: string }[];
    }

    const queued = pending.length;
    let synced = 0;
    let failed = 0;

    for (const row of pending) {
      try {
        await syncReview(row.id);
        synced++;
      } catch (err) {
        log.warn('sp-sync row failed', {
          module: 'construction-qa',
          reviewId: row.id,
          error: (err as Error).message,
        });
        failed++;
      }
    }

    log.info('sp-sync batch complete', {
      module: 'construction-qa',
      projectId: projectId ?? 'all',
      queued,
      synced,
      failed,
    });

    return apiResponse.success(res, { queued, synced, failed });
  } catch (error) {
    log.error('sp-sync fatal', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('super_admin')(handler));
