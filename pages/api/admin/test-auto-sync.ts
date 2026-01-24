/**
 * Admin API: Test Auto-Sync Trigger
 *
 * DELETE THIS FILE AFTER TESTING
 *
 * POST /api/admin/test-auto-sync
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const testDropNumber = req.body.dropNumber || 'DR9999999';

  try {
    console.log(`\n🧪 Testing auto-sync trigger for ${testDropNumber}...\n`);

    // Step 1: Check if drop already exists
    const existing = await sql`
      SELECT id FROM qa_photo_reviews WHERE drop_number = ${testDropNumber}
    `;

    if (existing.length > 0) {
      console.log(`Drop ${testDropNumber} already exists, deleting for fresh test...`);
      await sql`DELETE FROM qa_photo_reviews WHERE drop_number = ${testDropNumber}`;
      await sql`DELETE FROM onemap_sync_queue WHERE drop_number = ${testDropNumber}`;
    }

    // Step 2: Insert new drop (triggers auto_sync_onemap_serials)
    console.log(`Inserting drop ${testDropNumber}...`);
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

    console.log('✓ Drop inserted');

    // Step 3: Check if trigger added it to sync queue
    console.log('Checking sync queue...');
    const queueItems = await sql`
      SELECT * FROM onemap_sync_queue
      WHERE drop_number = ${testDropNumber}
    `;

    if (queueItems.length > 0) {
      console.log('✓ Drop automatically added to sync queue!');

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
    console.error('Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
    });
  }
}

export default withAuth(handler);
