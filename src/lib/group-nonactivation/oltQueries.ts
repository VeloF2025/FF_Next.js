/**
 * Open OLT-reconciliation worklist for a project — the Note 2 / Note 4 items
 * behind /activate/data-sync?group=olt&tab=pending and &tab=investigate.
 *
 * Project-scoped (not group-scoped) for the same reason the PP tab is: an OLT
 * mismatch is raised against a DR from the nightly OES/1Map sweep, not against
 * a WhatsApp submission — ~35% of open records have no WA submission at all, so
 * per-group attribution would silently drop them. Shown on activations
 * (dr_submission) groups only, matching `showPp`.
 *
 * @module lib/group-nonactivation/oltQueries
 */
import { pool } from '@/lib/db';
import { OLT_OPEN_STATES, type OltFixStatus } from './format';

export interface OltRow {
  dropNumber: string;
  /** OES serial — our source of truth. */
  oesSerial: string | null;
  /** What 1Map currently holds (null when 1Map has no serial / no record). */
  onemapSerial: string | null;
  fixStatus: OltFixStatus;
  /** NOC ticket already raised for this record, when there is one. */
  ticketUid: string | null;
  /** Date the mismatch was first raised (YYYY-MM-DD, SAST). */
  raisedDate: string;
  /** Raised on the cohort day — NEW this run rather than carried over. */
  isNew: boolean;
}

interface OltRaw {
  drop_number: string;
  oes_serial: string | null;
  onemap_serial: string | null;
  fix_status: OltFixStatus;
  ticket_uid: string | null;
  raised_date: string;
  is_new: boolean;
}

/**
 * Every still-open OLT mismatch for `projectName`, newest first, flagged NEW
 * when raised on `cohortDate`. Project resolution mirrors the data-sync APIs
 * (`COALESCE(i.project, p.project_name)`) so the workbook reconciles 1:1 with
 * what the tabs show. Returns [] for a group with no project.
 */
export async function getOltWorklist(
  projectName: string | null,
  cohortDate: string,
): Promise<OltRow[]> {
  if (!projectName) return [];
  const { rows } = await pool.query(
    `SELECT r.drop_number,
            NULLIF(NULLIF(TRIM(r.olt_serial), ''), '-') AS oes_serial,
            NULLIF(TRIM(r.wrong_onemap_serial), '') AS onemap_serial,
            r.fix_status,
            mt.ticket_uid,
            (r.created_at AT TIME ZONE 'Africa/Johannesburg')::date::text AS raised_date,
            ((r.created_at AT TIME ZONE 'Africa/Johannesburg')::date = $2::date) AS is_new
       FROM olt_mismatch_records r
       LEFT JOIN olt_report_imports i ON r.import_id = i.id
       LEFT JOIN drops d ON r.drop_number = d.drop_number
       LEFT JOIN projects p ON d.project_id = p.id
       LEFT JOIN maintenance_tickets mt ON r.maintenance_ticket_id = mt.id
      WHERE r.fix_status = ANY($3::text[])
        AND COALESCE(i.project, p.project_name) = $1
      ORDER BY is_new DESC, r.created_at DESC, r.drop_number`,
    [projectName, cohortDate, OLT_OPEN_STATES],
  );
  return (rows as OltRaw[]).map((r) => ({
    dropNumber: r.drop_number,
    oesSerial: r.oes_serial,
    onemapSerial: r.onemap_serial,
    fixStatus: r.fix_status,
    ticketUid: r.ticket_uid,
    raisedDate: r.raised_date,
    isNew: r.is_new,
  }));
}
