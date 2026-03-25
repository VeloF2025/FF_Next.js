/**
 * Admin API: Test Auto-Sync Trigger
 *
 * DELETE THIS FILE AFTER TESTING
 *
 * POST /api/admin/test-auto-sync
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const testDropNumber = req.body.dropNumber || 'DR9999999';

  try {
    log.debug('adminTest', { action: 'test-auto-sync', dropNumber: testDropNumber });

    // Step 1: Check if drop already exists
    const existing = await sql`
      SELECT id FROM qa_photo_reviews WHERE drop_number = ${testDropNumber}
    `;

    if (existing.length > 0) {
      log.debug('adminTest', { action: 'test-auto-sync', step: 'cleanup', dropNumber: testDropNumber });
      await sql`DELETE FROM qa_photo_reviews WHERE drop_number = ${testDropNumber}`;
      await sql`DELETE FROM onemap_sync_queue WHERE drop_number = ${testDropNumber}`;
    }

    // Step 2: Insert new drop (triggers auto_sync_onemap_serials)
    log.debug('adminTest', { action: 'test-auto-sync', step: 'insert-drop', dropNumber: testDropNumber });
    await sql`
      INSERT INTO qa_photo_reviews (
        drop_number,
        project,
        created_at,
        updated_at,
        user_name
      ) VALUES (
        ${testDropNumber},
        'Test Project',
        NOW(),
        NOW(),
        'Test User'
      )
    `;

    log.debug('adminTest', { action: 'test-auto-sync', step: 'drop-inserted', dropNumber: testDropNumber });

    // Step 3: Check if trigger added it to sync queue
    log.debug('adminTest', { action: 'test-auto-sync', step: 'check-queue' });
    const queueItems = await sql`
      SELECT id, drop_number, status, attempts, created_at
      FROM onemap_sync_queue
      WHERE drop_number = ${testDropNumber}
    `;

    if (queueItems.length > 0) {
      log.debug('adminTest', {
        action: 'test-auto-sync',
        step: 'success',
        dropNumber: testDropNumber,
        queueItemId: queueItems[0].id
      });

      return res.status(200).json({
        success: true,
        message: 'Auto-sync trigger working correctly',
        details: {
          dropInserted: testDropNumber,
          queueItem: {
            id: queueItems[0].id,
            drop_number: queueItems[0].drop_number,
            status: queueItems[0].status,
            attempts: queueItems[0].attempts,
            created_at: queueItems[0].created_at,
          },
          nextStep: 'Call POST /api/onemap/process-sync-queue to process the queue',
        },
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Trigger did not add drop to sync queue',
      });
    }
  } catch (error) {
    log.error('adminTest', {
      action: 'test-auto-sync',
      error: error instanceof Error ? error.message : 'Test failed'
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
    });
  }
}

export default withAuth(withRole('admin')(handler));
