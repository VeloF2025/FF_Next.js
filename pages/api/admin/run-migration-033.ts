/**
 * Admin API: Run Migration 033 (OneMap Auto-Sync)
 *
 * DELETE THIS FILE AFTER RUNNING THE MIGRATION
 *
 * POST /api/admin/run-migration-033
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

  try {
    log.debug('migration', { action: 'run-migration-033', step: 'start' });

    // Create sync queue table
    await sql`
      CREATE TABLE IF NOT EXISTS onemap_sync_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        drop_number TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_onemap_sync_queue_status ON onemap_sync_queue(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_onemap_sync_queue_created_at ON onemap_sync_queue(created_at)`;

    log.debug('migration', { action: 'run-migration-033', step: 'table-created' });

    // Create trigger function
    await sql`
      CREATE OR REPLACE FUNCTION auto_sync_onemap_serials()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.drop_number IS NULL OR NEW.drop_number = '' THEN
          RETURN NEW;
        END IF;

        INSERT INTO onemap_sync_queue (drop_number, status, created_at)
        VALUES (NEW.drop_number, 'pending', NOW())
        ON CONFLICT (drop_number) DO NOTHING;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;

    log.debug('migration', { action: 'run-migration-033', step: 'function-created' });

    // Create trigger
    await sql`DROP TRIGGER IF EXISTS trigger_auto_sync_onemap_serials ON qa_photo_reviews`;
    await sql`
      CREATE TRIGGER trigger_auto_sync_onemap_serials
        AFTER INSERT ON qa_photo_reviews
        FOR EACH ROW
        EXECUTE FUNCTION auto_sync_onemap_serials()
    `;

    log.debug('migration', { action: 'run-migration-033', step: 'trigger-created' });

    return res.status(200).json({
      success: true,
      message: 'Migration 033 completed successfully',
      details: {
        table: 'onemap_sync_queue created',
        function: 'auto_sync_onemap_serials() created',
        trigger: 'trigger_auto_sync_onemap_serials created',
      },
    });
  } catch (error) {
    log.error('migration', {
      action: 'run-migration-033',
      error: error instanceof Error ? error.message : 'Migration failed'
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Migration failed',
    });
  }
}

export default withAuth(withRole('admin')(handler));
