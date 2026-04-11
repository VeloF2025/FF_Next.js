/**
 * GET /api/activate/non-invoiceables/billing-crossref
 *
 * Cross-references FT billing deductions for a given billing week against
 * existing tickets and system records. Answers: "Of everything FT deducted
 * this week, what did we already know about and action?"
 *
 * Params: billing_week_id (UUID) — OR — week_ending + project
 * // 🟢 WORKING: two explicit query branches, no conditional SQL fragments
 */

import type { NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import { NOTE_TO_CATEGORY, type NonInvoiceableCategory } from '@/modules/non-invoiceables/types';

const logger = createLogger('api/activate/non-invoiceables/billing-crossref');

// ─── DB row types ─────────────────────────────────────────────────────────────

interface BillingWeekRow {
  id: string; week_ending: string; project: string;
  ft_total_claimable: number | null;
  ft_note1_count: number | null; ft_note2_count: number | null;
  ft_note3_count: number | null; ft_note4_count: number | null;
  ft_note5_count: number | null;
}

interface CrossRefRow {
  id: string; dr_number: string; deduction_note: string;
  serial_number: string | null; team: string | null; deduction_reason: string | null;
  oes_status: string | null; oes_activation_date: string | null; oes_signal_dbm: number | null;
  olt_record_id: string | null; olt_fix_status: string | null;
  olt_ticket_id: string | null; olt_ticket_uid: string | null;
  olt_ticket_status: string | null; olt_ticket_created_at: string | null;
  pp_record_id: string | null; pp_status: string | null;
  pp_ticket_id: string | null; pp_ticket_uid: string | null;
  pp_ticket_status: string | null; pp_ticket_created_at: string | null;
  offline_record_id: string | null; mismatch_status: string | null;
  offline_ticket_id: string | null; offline_ticket_uid: string | null;
  offline_ticket_status: string | null; offline_ticket_created_at: string | null;
  has_dr_record: boolean; dr_review_status: string | null;
  // Note 5 offline evidence columns (from nightly offline sync)
  od_note5_id: string | null;
  od_note5_reason: string | null;
  od_note5_recovered_at: string | null;
}

// ─── Response types ───────────────────────────────────────────────────────────

/** Dispute flag derived from Note 5 offline evidence. */
type DisputeFlag = 'none' | 'dispute_candidate' | 'recovered' | 'dying_gasp';

interface CrossRefItem {
  dr_number: string; note_type: string;
  category: NonInvoiceableCategory;
  action_status: 'actioned' | 'missed' | 'actioned_late';
  ticket_uid: string | null; ticket_status: string | null; ticket_created_at: string | null;
  oes_status: string | null; signal_dbm: number | null; has_dr: boolean;
  // Note 5 offline evidence
  offline_confirmed: boolean;
  offline_reason: string | null;
  offline_recovered_at: string | null;
  dispute_flag: DisputeFlag;
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

// ⚪ NOTE: Two explicit query branches used below (by billing_week_id only, no
// conditional fragments). The $1 parameter is always the billing_week_id UUID.
const CROSSREF_SQL = `
SELECT d.id, d.dr_number, d.deduction_note, d.serial_number, d.team, d.deduction_reason,
  oa.status AS oes_status, oa.activation_date AS oes_activation_date, oa.ont_rx_sig_dbm AS oes_signal_dbm,
  olt.id AS olt_record_id, olt.fix_status AS olt_fix_status,
  olt.maintenance_ticket_id AS olt_ticket_id, olt_mt.ticket_uid AS olt_ticket_uid,
  olt_mt.status AS olt_ticket_status, olt_mt.created_at AS olt_ticket_created_at,
  pp.id AS pp_record_id, pp.resolution_status AS pp_status,
  pp.maintenance_ticket_id AS pp_ticket_id, pp_mt.ticket_uid AS pp_ticket_uid,
  pp_mt.status AS pp_ticket_status, pp_mt.created_at AS pp_ticket_created_at,
  od.id AS offline_record_id, od.mismatch_status,
  od.mismatch_ticket_id AS offline_ticket_id, od_mt.ticket_uid AS offline_ticket_uid,
  od_mt.status AS offline_ticket_status, od_mt.created_at AS offline_ticket_created_at,
  CASE WHEN dr.id IS NOT NULL THEN true ELSE false END AS has_dr_record,
  dr.human_review_status AS dr_review_status,
  od_note5.id          AS od_note5_id,
  od_note5.reason      AS od_note5_reason,
  od_note5.recovered_at AS od_note5_recovered_at
FROM ft_billing_deductions d
LEFT JOIN oes_activations oa ON oa.drop_number = d.dr_number
LEFT JOIN olt_mismatch_records olt ON olt.drop_number = d.dr_number
LEFT JOIN maintenance_tickets olt_mt ON olt_mt.id = olt.maintenance_ticket_id
LEFT JOIN oes_pp_data pp ON pp.serial_number = d.serial_number AND pp.project = d.project
LEFT JOIN maintenance_tickets pp_mt ON pp_mt.id = pp.maintenance_ticket_id
LEFT JOIN offline_devices od ON od.drop_number = d.dr_number AND od.serial_mismatch = true
LEFT JOIN maintenance_tickets od_mt ON od_mt.id = od.mismatch_ticket_id
LEFT JOIN dr_photo_unified_reviews dr ON dr.drop_number = d.dr_number
LEFT JOIN LATERAL (
  SELECT od2.id, od2.last_down_reason AS reason, od2.last_inform_date,
         od2.recovered_at, od2.offline_ticket_id, od2.offline_ticket_created_at
  FROM offline_devices od2
  INNER JOIN ft_weekly_billing wb ON wb.id = d.billing_week_id
  WHERE od2.drop_number = d.dr_number
    AND od2.report_date BETWEEN wb.week_ending::date - 14 AND wb.week_ending::date
    AND od2.recovered_at IS NULL
  ORDER BY od2.report_date DESC
  LIMIT 1
) od_note5 ON true
WHERE d.billing_week_id = $1
ORDER BY d.deduction_note, d.dr_number`;

const WEEK_COLS = `id, week_ending, project, ft_total_claimable,
  ft_note1_count, ft_note2_count, ft_note3_count, ft_note4_count, ft_note5_count`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** action_status derived from ticket creation date vs billing week_ending. */
function computeActionStatus(
  row: CrossRefRow, weekEnding: string,
): 'actioned' | 'missed' | 'actioned_late' {
  const createdAt = row.olt_ticket_created_at ?? row.pp_ticket_created_at ?? row.offline_ticket_created_at;
  if (!createdAt) return 'missed';
  return new Date(createdAt) <= new Date(weekEnding) ? 'actioned' : 'actioned_late';
}

/**
 * Derive dispute_flag for Note 5 deductions:
 *   dispute_candidate — no offline evidence found in the 14-day window
 *   recovered         — offline record found but device already recovered
 *   dying_gasp        — offline reason is 'Dying Gasp' (transient signal loss)
 *   none              — not a Note 5 deduction, or evidence confirms offline state
 */
function computeDisputeFlag(row: CrossRefRow): DisputeFlag {
  if (row.deduction_note !== 'note5') return 'none';
  if (!row.od_note5_id) return 'dispute_candidate';
  if (row.od_note5_recovered_at) return 'recovered';
  if (row.od_note5_reason === 'Dying Gasp') return 'dying_gasp';
  return 'none';
}

async function loadWeekById(id: string): Promise<BillingWeekRow | null> {
  const r = await pool.query<BillingWeekRow>(
    `SELECT ${WEEK_COLS} FROM ft_weekly_billing WHERE id = $1`, [id],
  );
  return r.rows[0] ?? null;
}

async function loadWeekByDateProject(weekEnding: string, project: string): Promise<BillingWeekRow | null> {
  const r = await pool.query<BillingWeekRow>(
    `SELECT ${WEEK_COLS} FROM ft_weekly_billing WHERE week_ending = $1 AND project ILIKE $2 LIMIT 1`,
    [weekEnding, project],
  );
  return r.rows[0] ?? null;
}

async function loadLatestWeek(project?: string): Promise<BillingWeekRow | null> {
  const q = project
    ? `SELECT ${WEEK_COLS} FROM ft_weekly_billing WHERE project ILIKE $1 ORDER BY week_ending DESC LIMIT 1`
    : `SELECT ${WEEK_COLS} FROM ft_weekly_billing ORDER BY week_ending DESC LIMIT 1`;
  const r = await pool.query<BillingWeekRow>(q, project ? [project] : []);
  return r.rows[0] ?? null;
}

async function loadAdjacentWeekIds(week: BillingWeekRow): Promise<{ prev: string | null; next: string | null }> {
  const [prev, next] = await Promise.all([
    pool.query<{ id: string }>(
      `SELECT id FROM ft_weekly_billing WHERE project = $1 AND week_ending < $2 ORDER BY week_ending DESC LIMIT 1`,
      [week.project, week.week_ending],
    ),
    pool.query<{ id: string }>(
      `SELECT id FROM ft_weekly_billing WHERE project = $1 AND week_ending > $2 ORDER BY week_ending ASC LIMIT 1`,
      [week.project, week.week_ending],
    ),
  ]);
  return { prev: prev.rows[0]?.id ?? null, next: next.rows[0]?.id ?? null };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { billing_week_id, week_ending, project } = req.query;
  const projectStr = typeof project === 'string' && project.trim() ? project.trim() : undefined;
  let week: BillingWeekRow | null = null;

  if (typeof billing_week_id === 'string' && billing_week_id.trim()) {
    week = await loadWeekById(billing_week_id.trim());
  } else if (typeof week_ending === 'string' && week_ending.trim() && projectStr) {
    week = await loadWeekByDateProject(week_ending.trim(), projectStr);
  } else {
    // Fallback: latest week (optionally filtered by project)
    week = await loadLatestWeek(projectStr);
  }

  if (!week) {
    // No billing weeks exist — return empty-state response rather than 404
    return apiResponse.success(res, {
      week: null,
      rows: [],
      summary: { actioned: 0, missed: 0, actioned_late: 0, coverage_rate: 0 },
      prev_week_id: null,
      next_week_id: null,
    });
  }

  try {
    const { rows } = await pool.query<CrossRefRow>(CROSSREF_SQL, [week.id]);

    const items: CrossRefItem[] = rows.map((row) => {
      const action_status = computeActionStatus(row, week!.week_ending);
      // First non-null ticket wins — priority: OLT > PP > offline
      const ticket_uid    = row.olt_ticket_uid    ?? row.pp_ticket_uid    ?? row.offline_ticket_uid    ?? null;
      const ticket_status = row.olt_ticket_uid    ? row.olt_ticket_status
                          : row.pp_ticket_uid     ? row.pp_ticket_status
                          : row.offline_ticket_uid ? row.offline_ticket_status : null;
      const ticket_created_at = row.olt_ticket_uid    ? row.olt_ticket_created_at
                               : row.pp_ticket_uid     ? row.pp_ticket_created_at
                               : row.offline_ticket_uid ? row.offline_ticket_created_at : null;

      return {
        dr_number: row.dr_number,
        note_type: row.deduction_note,
        category: NOTE_TO_CATEGORY[row.deduction_note] ?? 'serial_mismatch',
        action_status,
        ticket_uid,
        ticket_status,
        ticket_created_at: ticket_created_at ? String(ticket_created_at) : null,
        oes_status: row.oes_status,
        signal_dbm: row.oes_signal_dbm,
        has_dr: row.has_dr_record,
        offline_confirmed: row.od_note5_id !== null,
        offline_reason: row.od_note5_reason ?? null,
        offline_recovered_at: row.od_note5_recovered_at
          ? String(row.od_note5_recovered_at)
          : null,
        dispute_flag: computeDisputeFlag(row),
      };
    });

    const { prev, next } = await loadAdjacentWeekIds(week);

    const total_deductions = items.length;
    const actioned      = items.filter((i) => i.action_status === 'actioned').length;
    const missed        = items.filter((i) => i.action_status === 'missed').length;
    const actioned_late = items.filter((i) => i.action_status === 'actioned_late').length;
    const coverage_rate = total_deductions > 0
      ? Math.round(((actioned + actioned_late) / total_deductions) * 10000) / 100
      : 0;
    const dispute_candidates     = items.filter((i) => i.dispute_flag === 'dispute_candidate').length;
    const recovered_since_deduction = items.filter((i) => i.dispute_flag === 'recovered').length;

    const payload = {
      week: {
        id: week.id,
        week_ending: String(week.week_ending),
        project: week.project,
      },
      rows: items,
      summary: {
        total_deductions, actioned, missed, actioned_late, coverage_rate,
        dispute_candidates, recovered_since_deduction,
      },
      prev_week_id: prev,
      next_week_id: next,
    };

    logger.info('billing crossref loaded', {
      billing_week_id: week.id, project: week.project,
      week_ending: week.week_ending, total_deductions, actioned, missed, actioned_late, coverage_rate,
    });

    return apiResponse.success(res, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load billing crossref';
    logger.error('billing-crossref GET failed', { error: message, billing_week_id: week.id });
    return res.status(500).json({ success: false, error: message });
  }
}

export default withAuth(handler as Parameters<typeof withAuth>[0]);
