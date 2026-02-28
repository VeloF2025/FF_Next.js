/**
 * QField Sync Dashboard API Endpoint
 * Returns dashboard data for the QField sync module
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    // Get connection status (simplified for now)
    const connectionStatus = {
      qfieldcloud: await checkQFieldConnection(),
      fibreflow: await checkDatabaseConnection(),
    };

    // Get QFieldCloud projects (mock data for now)
    const projects = await getQFieldProjects();

    // Get current sync job if any
    const currentJob = await getCurrentSyncJob();

    // Get recent sync jobs
    const recentJobs = await getRecentSyncJobs();

    // Get sync statistics
    const stats = await getSyncStatistics();

    // Get unresolved conflicts
    const conflicts = await getUnresolvedConflicts();

    // Get current configuration
    const config = await getSyncConfiguration();

    const dashboardData = {
      connectionStatus,
      projects,
      currentJob,
      recentJobs,
      stats,
      conflicts,
      config,
    };

    return apiResponse.success(res, dashboardData, 'Dashboard data retrieved successfully');

  } catch (error) {
    log.error('QField Sync Dashboard API error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function checkQFieldConnection(): Promise<'connected' | 'disconnected' | 'error'> {
  try {
    // Real check: hit QFieldCloud projects endpoint with a short timeout
    await qfieldApiRequest('/projects/');
    return 'connected';
  } catch (error: any) {
    // Network/auth error → disconnected; unexpected error → error
    const msg = error?.message || '';
    if (msg.includes('timeout') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
      return 'disconnected';
    }
    return 'error';
  }
}

async function checkDatabaseConnection(): Promise<'connected' | 'disconnected' | 'error'> {
  try {
    // Test database connection
    const result = await sql`SELECT 1 as connected`;
    return result && result[0]?.connected === 1 ? 'connected' : 'disconnected';
  } catch (error) {
    return 'error';
  }
}

async function getQFieldProjects() {
  try {
    const rows = await getQFieldCloudProjects();
    // Normalise to the shape the dashboard component expects
    return rows.map((r: any) => ({
      id: r.id || r.name,
      name: r.name,
      description: r.description || '',
      owner: r.owner_id || r.owner || 'FibreFlow',
      isPublic: r.is_public ?? false,
      lastModified: r.updated_at || r.last_modified || new Date().toISOString(),
      layers: [],       // Loaded on-demand per-project
      status: 'active' as const,
    }));
  } catch (error) {
    log.error('Failed to fetch QFieldCloud projects', { error }, 'qfield-sync-dashboard');
    return [];
  }
}

async function getCurrentSyncJob() {
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

    if (result[0]) {
      // Ensure all required fields are present
      return {
        ...result[0],
        type: result[0].type || 'fiber_cables',
        status: result[0].status || 'idle',
        direction: result[0].direction || 'bidirectional',
        errors: result[0].errors || []
      };
    }

    return null;
  } catch (error) {
    // Table might not exist yet
    return null;
  }
}

async function getRecentSyncJobs() {
  try {
    const result = await sql`
      SELECT
        id, type, status, direction, started_at, completed_at,
        records_processed, records_created, records_updated,
        records_failed, duration_ms
      FROM qfield_sync_jobs
      WHERE status IN ('completed', 'error')
      ORDER BY started_at DESC
      LIMIT 5
    `;

    return result.map(job => ({
      ...job,
      type: job.type || 'fiber_cables',
      status: job.status || 'completed',
      direction: job.direction || 'bidirectional',
      duration: job.duration_ms || 0,
      errors: [],
      recordsProcessed: job.records_processed || 0,
      recordsCreated: job.records_created || 0,
      recordsUpdated: job.records_updated || 0,
      recordsFailed: job.records_failed || 0,
    }));
  } catch (error) {
    // Table might not exist yet
    return [];
  }
}

async function getSyncStatistics() {
  try {
    const stats = await sql`
      SELECT
        COUNT(*) as total_syncs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_syncs,
        COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_syncs,
        SUM(records_processed) as total_records_synced,
        AVG(duration_ms) as average_sync_duration,
        MAX(completed_at) as last_sync
      FROM qfield_sync_jobs
      WHERE completed_at IS NOT NULL
    `;

    const result = stats[0] || {};

    return {
      lastSync: result.last_sync || null,
      totalSyncs: parseInt(result.total_syncs) || 0,
      successfulSyncs: parseInt(result.successful_syncs) || 0,
      failedSyncs: parseInt(result.failed_syncs) || 0,
      totalRecordsSynced: parseInt(result.total_records_synced) || 0,
      averageSyncDuration: parseInt(result.average_sync_duration) || 0,
      nextScheduledSync: null, // Calculate based on config
    };
  } catch (error) {
    // Return default stats if table doesn't exist
    return {
      lastSync: null,
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalRecordsSynced: 0,
      averageSyncDuration: 0,
      nextScheduledSync: null,
    };
  }
}

async function getUnresolvedConflicts() {
  try {
    const conflicts = await sql`
      SELECT
        id, record_id, field, qfield_value, fibreflow_value,
        detected_at, resolution, resolved_at, resolved_by
      FROM qfield_sync_conflicts
      WHERE resolution IS NULL
      ORDER BY detected_at DESC
      LIMIT 20
    `;

    return conflicts.map(conflict => ({
      ...conflict,
      qfieldValue: conflict.qfield_value,
      fibreflowValue: conflict.fibreflow_value,
      detectedAt: conflict.detected_at,
      resolvedAt: conflict.resolved_at,
      resolvedBy: conflict.resolved_by,
    }));
  } catch (error) {
    // Table might not exist yet
    return [];
  }
}

async function getSyncConfiguration() {
  // TODO: Store configuration in database or environment variables
  // For now, return default configuration
  return {
    qfieldcloud: {
      url: process.env.NEXT_PUBLIC_QFIELD_URL || 'https://qfield.fibreflow.app',
      projectId: process.env.NEXT_PUBLIC_QFIELD_PROJECT_ID || '',
      apiKey: '***', // Never expose the actual API key
      pollingInterval: 300,
    },
    fibreflow: {
      databaseUrl: '***', // Never expose the actual database URL
      targetTable: 'sow_fibre',
    },
    mapping: [],
    syncMode: 'automatic',
    syncDirection: 'bidirectional',
    autoResolveConflicts: false,
  };
}

export default withAuth(handler);