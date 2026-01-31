/**
 * Data Sync Stats API
 * Returns aggregated stats for the data sync overview dashboard
 *
 * GET /api/system/data-sync/stats
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { log } from '@/lib/logger';
import type { DataSyncStats } from '@/modules/data-sync/types';

const sql = createLoggedSql(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Fetch maintenance stats
    const maintenanceStats = await getMaintenanceStats();

    // Fetch activate stats
    const activateStats = await getActivateStats();

    // Fetch OLT stats
    const oltStats = await getOltStats();

    const stats: DataSyncStats = {
      maintenance: maintenanceStats,
      activate: activateStats,
      olt: oltStats,
    };

    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    log.error('Failed to fetch data sync stats', { error });
    return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
}

async function getMaintenanceStats() {
  try {
    // Get last QContact sync time
    const lastSyncResult = await sql`
      SELECT MAX(synced_at) as last_sync
      FROM qcontact_sync_log
      WHERE status = 'SUCCESS'
    `;
    const lastQContactSync = lastSyncResult[0]?.last_sync || null;

    // Get pending tickets count (tickets needing sync)
    const pendingResult = await sql`
      SELECT COUNT(*) as count
      FROM maintenance_tickets
      WHERE status NOT IN ('closed', 'resolved')
      AND (qcontact_synced_at IS NULL OR qcontact_synced_at < updated_at)
    `;
    const pendingTickets = parseInt(pendingResult[0]?.count || '0', 10);

    // Get weekly imports this month
    const importsResult = await sql`
      SELECT COUNT(*) as count
      FROM weekly_maintenance_reports
      WHERE created_at >= date_trunc('month', CURRENT_DATE)
    `;
    const weeklyImportsThisMonth = parseInt(importsResult[0]?.count || '0', 10);

    // Check sync health (>80% success rate in last 24h)
    const healthResult = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as success_count,
        COUNT(*) as total_count
      FROM qcontact_sync_log
      WHERE synced_at >= NOW() - INTERVAL '24 hours'
    `;
    const successCount = parseInt(healthResult[0]?.success_count || '0', 10);
    const totalCount = parseInt(healthResult[0]?.total_count || '1', 10);
    const syncHealthy = totalCount === 0 || (successCount / totalCount) >= 0.8;

    return {
      lastQContactSync,
      pendingTickets,
      weeklyImportsThisMonth,
      syncHealthy,
    };
  } catch (error) {
    log.warn('Error fetching maintenance stats, returning defaults', { error });
    return {
      lastQContactSync: null,
      pendingTickets: 0,
      weeklyImportsThisMonth: 0,
      syncHealthy: true,
    };
  }
}

async function getActivateStats() {
  try {
    // Get last OES import time
    const lastOesResult = await sql`
      SELECT MAX(imported_at) as last_import
      FROM oes_import_batches
    `;
    const lastOESImport = lastOesResult[0]?.last_import || null;

    // Get last ARCH import time
    const lastArchResult = await sql`
      SELECT MAX(imported_at) as last_import
      FROM offline_import_batches
    `;
    const lastARCHImport = lastArchResult[0]?.last_import || null;

    // Get total DRs in unified review table
    const drsResult = await sql`
      SELECT COUNT(*) as count FROM dr_photo_unified_reviews
    `;
    const totalDRs = parseInt(drsResult[0]?.count || '0', 10);

    // Get pending review count
    const pendingResult = await sql`
      SELECT COUNT(*) as count
      FROM dr_photo_unified_reviews
      WHERE overall_status = 'pending'
    `;
    const pendingReview = parseInt(pendingResult[0]?.count || '0', 10);

    return {
      lastOESImport,
      lastARCHImport,
      totalDRs,
      pendingReview,
    };
  } catch (error) {
    log.warn('Error fetching activate stats, returning defaults', { error });
    return {
      lastOESImport: null,
      lastARCHImport: null,
      totalDRs: 0,
      pendingReview: 0,
    };
  }
}

async function getOltStats() {
  try {
    // Get OLT mismatch stats
    const statsResult = await sql`
      SELECT
        COUNT(*) FILTER (WHERE fix_status = 'pending' OR fix_status IS NULL) as pending,
        COUNT(*) FILTER (WHERE fix_status = 'needs_investigation') as needs_investigation,
        COUNT(*) FILTER (WHERE fix_status = 'escalated') as escalated,
        COUNT(*) FILTER (WHERE fix_status = 'fixed' AND fix_attempted_at >= NOW() - INTERVAL '7 days') as fixed_this_week,
        COUNT(*) as total
      FROM olt_mismatch_records
    `;

    const row = statsResult[0] || {};

    return {
      pendingFixes: parseInt(row.pending || '0', 10),
      needsInvestigation: parseInt(row.needs_investigation || '0', 10),
      escalated: parseInt(row.escalated || '0', 10),
      fixedThisWeek: parseInt(row.fixed_this_week || '0', 10),
      totalImported: parseInt(row.total || '0', 10),
    };
  } catch (error) {
    log.warn('Error fetching OLT stats, returning defaults', { error });
    return {
      pendingFixes: 0,
      needsInvestigation: 0,
      escalated: 0,
      fixedThisWeek: 0,
      totalImported: 0,
    };
  }
}

export default withAuth(withErrorHandler(handler));
