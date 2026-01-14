/**
 * Admin API: Run Migration 033 (OneMap Auto-Sync)
 *
 * DELETE THIS FILE AFTER RUNNING THE MIGRATION
 *
 * POST /api/admin/run-migration-033
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Running migration 033...');

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

    console.log('✓ Created onemap_sync_queue table');

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

    console.log('✓ Created auto_sync_onemap_serials() function');

    // Create trigger
    await sql`DROP TRIGGER IF EXISTS trigger_auto_sync_onemap_serials ON qa_photo_reviews`;
    await sql`
      CREATE TRIGGER trigger_auto_sync_onemap_serials
        AFTER INSERT ON qa_photo_reviews
        FOR EACH ROW
        EXECUTE FUNCTION auto_sync_onemap_serials()
    `;

    console.log('✓ Created trigger on qa_photo_reviews');

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
    console.error('Migration failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Migration failed',
    });
  }
}
