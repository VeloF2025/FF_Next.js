/**
 * GET /api/tracker/build/[projectId]
 * Returns pon_stage_tracking rows with pon_manual_overrides merged.
 * LEFT JOIN mandatory — overrides are lazy-insert (may not exist per PON).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

interface Params { params: Promise<{ projectId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await params;

    const { rows } = await pool.query(
      `SELECT
         p.id,
         p.project_id,
         p.zone_no,
         p.pon_no,
         p.hld_pon,
         p.z_pon,
         p.olt_port,
         p.overall_stage,
         p.permissions_total,    p.permissions_approved,
         p.permissions_first_date, p.permissions_last_date,
         p.poles_total,           p.poles_planted,
         p.poles_first_date,      p.poles_last_date,
         p.cwc_total,             p.cwc_complete,
         p.cwc_first_date,        p.cwc_last_date,
         p.cwc_target_date,
         p.optical_total,         p.optical_complete,
         p.optical_first_date,    p.optical_last_date,
         p.optical_target_date,
         p.atp_total,             p.atp_passed,
         p.atp_first_date,        p.atp_last_date,
         p.activation_total,      p.activation_complete,
         p.activation_first_date, p.activation_last_date,
         p.activation_target_date,
         p.maintenance_total,     p.maintenance_complete,
         p.sign_ups,
         p.homes_po,
         p.homes_recon,
         p.available,
         p.scope_string,
         p.pct_original,
         p.pct_recon,
         p.blockage           AS auto_blockage,
         p.last_synced_at,
         p.sync_source,
         o.blockage           AS pm_blockage,
         o.civil_contractor,
         o.stringing_contractor,
         o.optical_contractor,
         o.optical_splitter,
         o.optical_type,
         o.atp_submitter_notes,
         o.override_notes,
         o.updated_by         AS override_updated_by,
         o.updated_at         AS override_updated_at
       FROM pon_stage_tracking p
       LEFT JOIN pon_manual_overrides o ON o.pon_stage_id = p.id
       WHERE p.project_id = $1
       ORDER BY p.zone_no, p.hld_pon, p.pon_no`,
      [projectId]
    );

    return NextResponse.json({ data: rows });
  } catch (err) {
    log.error('[tracker/build GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch build tracker' }, { status: 500 });
  }
}
