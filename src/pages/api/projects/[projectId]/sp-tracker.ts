/**
 * SP Tracker Data Endpoint
 * GET /api/projects/[projectId]/sp-tracker
 *
 * Returns SP Tracker summary, PON-level data, and sync metadata for a project.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
const apiResponse = (success: boolean, message: string, data?: unknown) => ({ success, message, ...(data !== undefined && { data }) });

const sql = neon(process.env.DATABASE_URL || '');

interface SpProjectSummary {
  id: string;
  project_id: string;
  permissions_scope: number | null;
  permissions_complete: number | null;
  pct_permissions: number | null;
  poles_scope: number | null;
  poles_complete: number | null;
  pct_poles: number | null;
  signups_scope: number | null;
  signups_complete: number | null;
  pct_signups: number | null;
  cwc_scope: number | null;
  cwc_complete: number | null;
  pct_cwc: number | null;
  optical_scope: number | null;
  optical_complete: number | null;
  pct_optical: number | null;
  connected_scope: number | null;
  connected_complete: number | null;
  pct_connected: number | null;
  synced_at: string | null;
}

interface SpPonTracker {
  id: string;
  project_id: string;
  zone_no: number;
  hld_pon: number;
  z_pon: number | null;
  olt_port: string | null;
  scope_poles: number | null;
  scope_drops: number | null;
  scope_string: number | null;
  pole_perm: number | null;
  poles_planted: number | null;
  sign_ups: number | null;
  cwc_poles_date: string | null;
  cwc_stringing_date: string | null;
  ready_for_optical_date: string | null;
  cwc_qa_approved: number;
  optical_splicing_date: string | null;
  optical_submitted_date: string | null;
  optical_activated_date: string | null;
  atp_qa_approved: number;
  homes_po: number | null;
  homes_recon: number | null;
  activated: number | null;
  available: number | null;
  pon_age_days: number | null;
  pct_original: number | null;
  pct_recon: number | null;
  blockage: string | null;
  synced_at: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json(apiResponse(false, 'Method not allowed'));
    return;
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    res.status(400).json(apiResponse(false, 'Missing projectId'));
    return;
  }

  try {
    const summaryRows = await sql`
      SELECT *
      FROM sp_project_summary
      WHERE project_id = ${projectId}
      LIMIT 1
    ` as SpProjectSummary[];

    const summary = summaryRows.length > 0 ? summaryRows[0] : null;

    const pons = await sql`
      SELECT *
      FROM sp_pon_tracker
      WHERE project_id = ${projectId}
      ORDER BY zone_no ASC, hld_pon ASC
    ` as SpPonTracker[];

    const lastSyncedAt = summary?.synced_at || null;
    const totalPons = pons.length;

    const blockedPons = pons.filter((p) => p.blockage && p.blockage.trim().length > 0).length;

    res.status(200).json(
      apiResponse(true, 'SP Tracker data retrieved', {
        summary,
        pons,
        lastSyncedAt,
        totalPons,
        blockedPons,
      })
    );
  } catch (err) {
    log.error('Failed to fetch SP tracker data', { err, projectId }, 'api/projects/sp-tracker');
    res.status(500).json(apiResponse(false, 'Failed to fetch tracker data'));
  }
}
