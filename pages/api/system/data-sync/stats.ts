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
import { apiResponse } from '@/lib/apiResponse';

const sql = createLoggedSql(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    // Fetch all stat groups in parallel
    const [nocStats, activateStats, oltStats, eodStats, qfieldStats, billingStats] = await Promise.all([
      getNocStats(),
      getActivateStats(),
      getOltStats(),
      getEodStats(),
      getQFieldStats(),
      getBillingStats(),
    ]);

    const stats: DataSyncStats = {
      noc: nocStats,
      activate: activateStats,
      olt: oltStats,
      eod: eodStats,
      qfield: qfieldStats,
      billing: billingStats,
    };

    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    log.error('Failed to fetch data sync stats', { error });
    return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
}

async function getNocStats() {
  try {
    // Run all NOC queries in parallel; qcontact_sync_log may not exist
    const [pendingResult, importsResult, qcontactResult] = await Promise.all([
      sql`
        SELECT COUNT(*) as count
        FROM maintenance_tickets
        WHERE status NOT IN ('closed', 'resolved')
        AND (qcontact_synced_at IS NULL OR qcontact_synced_at < updated_at)
      `,
      sql`
        SELECT COUNT(*) as count
        FROM weekly_maintenance_reports
        WHERE created_at >= date_trunc('month', CURRENT_DATE)
      `,
      sql`
        SELECT
          MAX(synced_at) FILTER (WHERE status = 'SUCCESS') as last_sync,
          COUNT(*) FILTER (WHERE status = 'SUCCESS' AND synced_at >= NOW() - INTERVAL '24 hours') as success_24h,
          COUNT(*) FILTER (WHERE synced_at >= NOW() - INTERVAL '24 hours') as total_24h
        FROM qcontact_sync_log
      `.catch(() => [{ last_sync: null, success_24h: '0', total_24h: '0' }]),
    ]);

    const qc = qcontactResult[0] || {};
    const total24h = parseInt(qc.total_24h || '0', 10);
    const success24h = parseInt(qc.success_24h || '0', 10);

    return {
      lastQContactSync: qc.last_sync || null,
      pendingTickets: parseInt(pendingResult[0]?.count || '0', 10),
      weeklyImportsThisMonth: parseInt(importsResult[0]?.count || '0', 10),
      syncHealthy: total24h === 0 || (success24h / total24h) >= 0.8,
    };
  } catch (error) {
    log.warn('Error fetching NOC stats, returning defaults', { error });
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

async function getQFieldStats() {
  try {
    const projectsResult = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sync_enabled = true) as active
      FROM qfield_projects
    `;
    const totalProjects = parseInt(projectsResult[0]?.total || '0', 10);
    const activeProjects = parseInt(projectsResult[0]?.active || '0', 10);

    const lastSyncResult = await sql`
      SELECT MAX(last_synced_at) as last_sync
      FROM qfield_projects
      WHERE sync_enabled = true
    `;
    const lastSync = lastSyncResult[0]?.last_sync || null;

    return { totalProjects, activeProjects, lastSync };
  } catch {
    return { totalProjects: 0, activeProjects: 0, lastSync: null };
  }
}

/**
 * Returns aggregated billing stats for the overview dashboard.
 * Anchored to ft_weekly_billing table — does not sum across weeks.
 */
async function getBillingStats() {
  try {
    const [result, paidResult, deductedResult] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int                                                     AS total_weeks,
          MAX(week_ending)::text                                            AS last_week,
          COUNT(*) FILTER (WHERE reconciliation_status = 'pending')::int   AS pending_count
        FROM ft_weekly_billing
      `,
      sql`
        SELECT COUNT(*)::int AS paid_count
        FROM oes_activations
        WHERE payment_status = 'paid'
      `,
      sql`
        SELECT COUNT(*)::int AS deducted_count
        FROM oes_activations
        WHERE payment_status = 'deducted'
      `,
    ]);
    return {
      totalWeeks: result[0]?.total_weeks ?? 0,
      lastUploadedWeek: result[0]?.last_week ?? null,
      pendingReconciliation: result[0]?.pending_count ?? 0,
      totalPaid: paidResult[0]?.paid_count ?? 0,
      totalDeducted: deductedResult[0]?.deducted_count ?? 0,
    };
  } catch (error) {
    log.warn('Error fetching billing stats', { error });
    return {
      totalWeeks: 0,
      lastUploadedWeek: null,
      pendingReconciliation: 0,
      totalPaid: 0,
      totalDeducted: 0,
    };
  }
}

async function getEodStats() {
  try {
    const [result] = await sql`
      SELECT
        COUNT(*)::int as total_sheets,
        MAX(sheet_date)::text as last_upload_date,
        (SELECT COUNT(*)::int FROM eod_install_sheet_entries WHERE match_status = 'pending') as pending_reconciliation
      FROM eod_install_sheets
    `;
    const totalMatched = await sql`
      SELECT COUNT(*)::int as matched FROM eod_install_sheet_entries WHERE match_status = 'matched_all'
    `;
    const totalEntries = await sql`
      SELECT COUNT(*)::int as total FROM eod_install_sheet_entries
    `;
    const total = totalEntries[0]?.total ?? 0;
    const matched = totalMatched[0]?.matched ?? 0;
    return {
      totalSheets: result?.total_sheets ?? 0,
      lastUploadDate: result?.last_upload_date ?? null,
      matchRate: total > 0 ? Math.round((matched / total) * 100) : 0,
      pendingReconciliation: result?.pending_reconciliation ?? 0,
    };
  } catch (error) {
    log.warn('Error fetching EOD stats', { error });
    return { totalSheets: 0, lastUploadDate: null, matchRate: 0, pendingReconciliation: 0 };
  }
}

export default withAuth(withErrorHandler(handler));
