/**
 * SP Tracker Sync Core Logic
 * Fetches data from SharePoint, parses, and upserts to DB
 */

import { neon } from '@/lib/db-neon';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';
import { log } from '@/lib/logger';
import { COL_MAP, mapRowData } from './mapper';
import type { SpTrackerConfig, SpPonRow, ProjectSummary } from './types';

const sql = neon(process.env.DATABASE_URL || '');

export async function syncTrackerForProject(
  config: SpTrackerConfig
): Promise<{ synced: number; error: string | null }> {
  try {
    const { values } = await getWorksheetRange(config.sheet_name, 'A3:Z300', config.drive_id, config.item_id);

    if (!values || values.length < 2) {
      return { synced: 0, error: `${config.project_name}: No data rows` };
    }

    const headers = (values[0] as string[]) || [];
    const headerMap = new Map<number, keyof SpPonRow>();

    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim();
      const dbCol = COL_MAP[h];
      if (dbCol) {
        headerMap.set(i, dbCol);
      }
    }

    let syncedCount = 0;
    const rows: SpPonRow[] = [];

    for (let rowIdx = 1; rowIdx < values.length; rowIdx++) {
      const rowData = values[rowIdx];
      if (!Array.isArray(rowData)) continue;

      const rowObj = mapRowData(rowData, headerMap) as Partial<SpPonRow>;

      const zoneNo = rowObj.zone_no;
      const hldPon = rowObj.hld_pon;

      if (!zoneNo || !hldPon) {
        continue;
      }

      rowObj.zone_no = zoneNo;
      rowObj.hld_pon = hldPon;
      rows.push(rowObj as SpPonRow);
    }

    for (const row of rows) {
      await sql`
        INSERT INTO sp_pon_tracker (
          project_id, zone_no, hld_pon, z_pon, olt_port, scope_poles,
          scope_drops, scope_string, pole_perm, poles_planted, sign_ups,
          cwc_poles_date, cwc_stringing_date, ready_for_optical_date,
          cwc_qa_approved, optical_splicing_date, optical_submitted_date,
          optical_activated_date, atp_qa_approved, homes_po, homes_recon,
          activated, available, pon_age_days, pct_original, pct_recon,
          blockage, synced_at
        )
        VALUES (
          ${config.project_id}, ${row.zone_no}, ${row.hld_pon}, ${row.z_pon},
          ${row.olt_port}, ${row.scope_poles}, ${row.scope_drops},
          ${row.scope_string}, ${row.pole_perm}, ${row.poles_planted},
          ${row.sign_ups}, ${row.cwc_poles_date}, ${row.cwc_stringing_date},
          ${row.ready_for_optical_date}, ${row.cwc_qa_approved},
          ${row.optical_splicing_date}, ${row.optical_submitted_date},
          ${row.optical_activated_date}, ${row.atp_qa_approved},
          ${row.homes_po}, ${row.homes_recon}, ${row.activated},
          ${row.available}, ${row.pon_age_days}, ${row.pct_original},
          ${row.pct_recon}, ${row.blockage}, now()
        )
        ON CONFLICT (project_id, zone_no, hld_pon)
        DO UPDATE SET
          z_pon = EXCLUDED.z_pon, olt_port = EXCLUDED.olt_port,
          scope_poles = EXCLUDED.scope_poles, scope_drops = EXCLUDED.scope_drops,
          scope_string = EXCLUDED.scope_string, pole_perm = EXCLUDED.pole_perm,
          poles_planted = EXCLUDED.poles_planted, sign_ups = EXCLUDED.sign_ups,
          cwc_poles_date = EXCLUDED.cwc_poles_date,
          cwc_stringing_date = EXCLUDED.cwc_stringing_date,
          ready_for_optical_date = EXCLUDED.ready_for_optical_date,
          cwc_qa_approved = EXCLUDED.cwc_qa_approved,
          optical_splicing_date = EXCLUDED.optical_splicing_date,
          optical_submitted_date = EXCLUDED.optical_submitted_date,
          optical_activated_date = EXCLUDED.optical_activated_date,
          atp_qa_approved = EXCLUDED.atp_qa_approved,
          homes_po = EXCLUDED.homes_po, homes_recon = EXCLUDED.homes_recon,
          activated = EXCLUDED.activated, available = EXCLUDED.available,
          pon_age_days = EXCLUDED.pon_age_days,
          pct_original = EXCLUDED.pct_original,
          pct_recon = EXCLUDED.pct_recon, blockage = EXCLUDED.blockage,
          synced_at = now(), updated_at = now()
      `;
    }

    syncedCount = rows.length;

    const summary = await computeProjectSummary(config.project_id);
    if (summary) {
      await sql`
        INSERT INTO sp_project_summary (
          project_id, permissions_scope, permissions_complete, pct_permissions,
          poles_scope, poles_complete, pct_poles, signups_scope,
          signups_complete, pct_signups, cwc_scope, cwc_complete, pct_cwc,
          optical_scope, optical_complete, pct_optical, connected_scope,
          connected_complete, pct_connected, synced_at
        )
        VALUES (
          ${config.project_id}, ${summary.permissions_scope},
          ${summary.permissions_complete}, ${summary.pct_permissions},
          ${summary.poles_scope}, ${summary.poles_complete},
          ${summary.pct_poles}, ${summary.signups_scope},
          ${summary.signups_complete}, ${summary.pct_signups},
          ${summary.cwc_scope}, ${summary.cwc_complete}, ${summary.pct_cwc},
          ${summary.optical_scope}, ${summary.optical_complete},
          ${summary.pct_optical}, ${summary.connected_scope},
          ${summary.connected_complete}, ${summary.pct_connected}, now()
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          permissions_scope = EXCLUDED.permissions_scope,
          permissions_complete = EXCLUDED.permissions_complete,
          pct_permissions = EXCLUDED.pct_permissions,
          poles_scope = EXCLUDED.poles_scope,
          poles_complete = EXCLUDED.poles_complete,
          pct_poles = EXCLUDED.pct_poles,
          signups_scope = EXCLUDED.signups_scope,
          signups_complete = EXCLUDED.signups_complete,
          pct_signups = EXCLUDED.pct_signups,
          cwc_scope = EXCLUDED.cwc_scope, cwc_complete = EXCLUDED.cwc_complete,
          pct_cwc = EXCLUDED.pct_cwc,
          optical_scope = EXCLUDED.optical_scope,
          optical_complete = EXCLUDED.optical_complete,
          pct_optical = EXCLUDED.pct_optical,
          connected_scope = EXCLUDED.connected_scope,
          connected_complete = EXCLUDED.connected_complete,
          pct_connected = EXCLUDED.pct_connected, synced_at = now()
      `;
    }

    return { synced: syncedCount, error: null };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error('Sync failed for project', { projectName: config.project_name, err });
    return { synced: 0, error: `${config.project_name}: ${errMsg}` };
  }
}

export async function computeProjectSummary(projectId: string): Promise<ProjectSummary | null> {
  try {
    const result = await sql`
      SELECT
        COALESCE(SUM(scope_poles), 0)::int AS poles_scope,
        COALESCE(SUM(poles_planted), 0)::int AS poles_complete,
        COALESCE(SUM(sign_ups), 0)::int AS signups_scope,
        COALESCE(SUM(sign_ups), 0)::int AS signups_complete,
        COALESCE(SUM(CASE WHEN cwc_poles_date IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS cwc_complete,
        COALESCE(SUM(CASE WHEN ready_for_optical_date IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS optical_complete,
        COALESCE(SUM(activated), 0)::int AS connected_complete
      FROM sp_pon_tracker
      WHERE project_id = ${projectId}
    `;

    if (!result.length) return null;

    const row = result[0] as Record<string, number>;
    const polesScope = row.poles_scope || 1;
    const signupsScope = row.signups_scope || 1;
    const cwcScope = polesScope;
    const opticalScope = polesScope;
    const connectedScope = polesScope;

    return {
      permissions_scope: polesScope,
      permissions_complete: row.poles_complete,
      pct_permissions: row.poles_complete / polesScope,
      poles_scope: polesScope,
      poles_complete: row.poles_complete,
      pct_poles: row.poles_complete / polesScope,
      signups_scope: signupsScope,
      signups_complete: row.signups_complete,
      pct_signups: row.signups_complete / signupsScope,
      cwc_scope: cwcScope,
      cwc_complete: row.cwc_complete,
      pct_cwc: row.cwc_complete / cwcScope,
      optical_scope: opticalScope,
      optical_complete: row.optical_complete,
      pct_optical: row.optical_complete / opticalScope,
      connected_scope: connectedScope,
      connected_complete: row.connected_complete,
      pct_connected: row.connected_complete / connectedScope,
    };
  } catch (err) {
    log.error('Failed to compute project summary', { err, projectId });
    return null;
  }
}
