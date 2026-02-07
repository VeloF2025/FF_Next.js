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

    // TODO: Trigger actual sync process
    // This would typically be done via a background job queue
    // For now, we'll simulate it by updating the job after a delay
    setTimeout(async () => {
      await simulateSyncCompletion(jobId);
    }, 5000);

    return apiResponse.success(res, job, 'Sync job started successfully');

  } catch (error) {
    log.error('QField Sync Start API error', { error });

    // Check if the error is because the table doesn't exist
    if (error instanceof Error && error.message.includes('does not exist')) {
      // Create the necessary tables
      await createSyncTables();
      return res.status(503).json({
        success: false,
        error: 'Sync tables are being created. Please try again.',
      });
    }

    return apiResponse.internalError(res, error);
  }
}

async function simulateSyncCompletion(jobId: string) {
  try {
    // Simulate some processing
    const processed = Math.floor(Math.random() * 100) + 50;
    const created = Math.floor(Math.random() * 30) + 10;
    const updated = Math.floor(Math.random() * 20) + 5;
    const failed = Math.floor(Math.random() * 5);

    // Update job as completed
    await sql`
      UPDATE qfield_sync_jobs
      SET
        status = 'completed',
        completed_at = ${new Date().toISOString()},
        records_processed = ${processed},
        records_created = ${created},
        records_updated = ${updated},
        records_failed = ${failed},
        duration_ms = 5000
      WHERE id = ${jobId}
    `;

    // Simulate syncing some fiber cable data
    await syncSampleFiberCables();

  } catch (error) {
    log.error('Error completing sync job', { error });

    // Mark job as failed
    await sql`
      UPDATE qfield_sync_jobs
      SET
        status = 'error',
        completed_at = ${new Date().toISOString()},
        errors = ${JSON.stringify([{ message: error instanceof Error ? error.message : 'Unknown error' }])}
      WHERE id = ${jobId}
    `;
  }
}

async function syncSampleFiberCables() {
  // Simulate syncing some fiber cable data
  const sampleCables = [
    {
      cable_id: 'FC-' + Date.now(),
      cable_type: '48-core SM',
      cable_size: '48',
      fiber_count: 48,
      start_location: 'P001',
      end_location: 'P005',
      length: Math.random() * 1000 + 100,
      status: 'completed',
      installation_date: new Date().toISOString().split('T')[0],
      installed_by: 'QField Sync',
    },
  ];

  for (const cable of sampleCables) {
    try {
      // Check if cable exists
      const existing = await sql`
        SELECT cable_id FROM sow_fibre
        WHERE cable_id = ${cable.cable_id}
        LIMIT 1
      `;

      if (existing.length === 0) {
        // Insert new cable
        await sql`
          INSERT INTO sow_fibre (
            cable_id, cable_type, cable_size, fiber_count,
            start_location, end_location, length, status,
            installation_date, installed_by
          ) VALUES (
            ${cable.cable_id},
            ${cable.cable_type},
            ${cable.cable_size},
            ${cable.fiber_count},
            ${cable.start_location},
            ${cable.end_location},
            ${cable.length},
            ${cable.status},
            ${cable.installation_date},
            ${cable.installed_by}
          )
        `;
      }
    } catch (error) {
      log.error('Error syncing sample cable', { error });
    }
  }
}

async function createSyncTables() {
  try {
    // Create sync jobs table
    await sql`
      CREATE TABLE IF NOT EXISTS qfield_sync_jobs (
        id UUID PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        direction VARCHAR(30) NOT NULL,
        started_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP,
        records_processed INT DEFAULT 0,
        records_created INT DEFAULT 0,
        records_updated INT DEFAULT 0,
        records_failed INT DEFAULT 0,
        errors JSONB DEFAULT '[]',
        duration_ms INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create sync conflicts table
    await sql`
      CREATE TABLE IF NOT EXISTS qfield_sync_conflicts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        record_id VARCHAR(255) NOT NULL,
        field VARCHAR(100) NOT NULL,
        qfield_value JSONB,
        fibreflow_value JSONB,
        detected_at TIMESTAMP NOT NULL,
        resolution VARCHAR(20),
        resolved_at TIMESTAMP,
        resolved_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON qfield_sync_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_sync_jobs_started ON qfield_sync_jobs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolution ON qfield_sync_conflicts(resolution);
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_record ON qfield_sync_conflicts(record_id);
    `;

  } catch (error) {
    log.error('Error creating sync tables', { error });
    throw error;
  }
}

export default withAuth(handler);