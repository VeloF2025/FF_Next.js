/**
 * GET /api/activate/action-centre/recon
 *
 * Weekly reconciliation view for the Action Centre. For each DR that
 * Fibertime billed on the given week (deduction note), return the
 * side-by-side: FT billed ↔ OES activation ↔ our 1Map fix history.
 *
 * Classifies each row as:
 *   - already_fixed_still_billed : our serial_reconciled pre-dates the
 *     billing flag (dispute candidate)
 *   - actionable                 : we have OES serial, no prior fix
 *   - blocked_no_installed       : OES activated but olt_mismatch shows
 *     no Installed prop on 1Map (Fibertime side)
 *   - no_oes                     : no OES record — can't fix anything
 *   - unknown                    : none of the above, needs investigation
 *
 * Query params:
 *   week    — week ending date (YYYY-MM-DD). Defaults to latest.
 *   note    — filter to one note code (note1..note5). Default: all.
 *   project — ILIKE match.
 *   limit   — default 500, max 1000.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/activate/action-centre/recon');

type Classification =
  | 'already_fixed_still_billed'
  | 'actionable'
  | 'blocked_no_installed'
  | 'no_oes'
  | 'unknown';

interface ReconRow {
  drNumber: string;
  noteCode: string;
  project: string | null;
  team: string | null;
  ftSerial: string | null;
  oesSerial: string | null;
  oesActivatedAt: string | null;
  lastFixSerial: string | null;
  lastFixAt: string | null;
  oltRejected: boolean;
  classification: Classification;
  weeksFlagged: number;
  resolutionStatus: string | null;
  ticketUid: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const week = typeof req.query.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week)
    ? req.query.week
    : null;
  const noteFilter = typeof req.query.note === 'string' ? req.query.note : null;
  const projectFilter = typeof req.query.project === 'string' ? req.query.project : null;
  const limit = Math.min(1000, Math.max(10, Number(req.query.limit) || 500));

  try {
    // Resolve the week we care about (provided or latest).
    const weekResolved = week ?? (
      await pool.query<{ w: string }>(
        `SELECT MAX(week_ending)::text AS w FROM ft_billing_deductions`,
      )
    ).rows[0]?.w ?? null;

    if (!weekResolved) {
      return apiResponse.success(res, { week: null, rows: [], count: 0 });
    }

    const params: unknown[] = [weekResolved];
    const clauses: string[] = ['d.week_ending = $1::date'];

    if (noteFilter) {
      params.push(noteFilter);
      clauses.push(`d.deduction_note = $${params.length}`);
    }
    if (projectFilter) {
      params.push(projectFilter);
      clauses.push(`d.project ILIKE $${params.length}`);
    }
    params.push(limit);
    const limitIdx = params.length;

    // Pull billing rows + OES latest + last olt_mismatch fix + last
    // serial_reconciled event in one query. Classification happens in app code.
    const { rows } = await pool.query<{
      dr_number: string;
      note_code: string;
      project: string | null;
      team: string | null;
      ft_serial: string | null;
      resolution_status: string | null;
      ticket_uid: string | null;
      oes_serial: string | null;
      oes_activated_at: string | null;
      last_fix_serial: string | null;
      last_fix_at: string | null;
      olt_rejected: boolean;
      weeks_flagged: string;
    }>(
      `
      WITH billing AS (
        SELECT d.dr_number, d.deduction_note AS note_code, d.project, d.team,
               d.serial_number AS ft_serial,
               d.resolution_status,
               t.ticket_uid
          FROM ft_billing_deductions d
          LEFT JOIN maintenance_tickets t ON t.id = d.ticket_id
         WHERE ${clauses.join(' AND ')}
      ),
      latest_oes AS (
        SELECT DISTINCT ON (drop_number) drop_number, serial_number, activation_date
          FROM oes_activations
         WHERE drop_number IN (SELECT dr_number FROM billing)
         ORDER BY drop_number, COALESCE(activation_datetime, created_at) DESC
      ),
      last_fix AS (
        SELECT DISTINCT ON (drop_number)
               drop_number, new_value AS last_fix_serial, created_at AS last_fix_at
          FROM serial_change_history
         WHERE change_source = 'olt_report_fix' AND change_type = 'ont_serial'
           AND drop_number IN (SELECT dr_number FROM billing)
         ORDER BY drop_number, created_at DESC
      ),
      olt_rej AS (
        SELECT DISTINCT drop_number
          FROM olt_mismatch_records
         WHERE fix_status = 'rejected'
           AND drop_number IN (SELECT dr_number FROM billing)
      ),
      weeks_flagged AS (
        SELECT b.dr_number, b.note_code,
               (SELECT COUNT(DISTINCT week_ending)
                  FROM ft_billing_deductions
                 WHERE dr_number = b.dr_number AND deduction_note = b.note_code) AS weeks
          FROM billing b
      )
      SELECT b.dr_number, b.note_code, b.project, b.team, b.ft_serial,
             b.resolution_status, b.ticket_uid,
             o.serial_number AS oes_serial,
             o.activation_date::text AS oes_activated_at,
             f.last_fix_serial,
             f.last_fix_at::text,
             (r.drop_number IS NOT NULL) AS olt_rejected,
             w.weeks::text AS weeks_flagged
        FROM billing b
        LEFT JOIN latest_oes o ON o.drop_number = b.dr_number
        LEFT JOIN last_fix   f ON f.drop_number = b.dr_number
        LEFT JOIN olt_rej    r ON r.drop_number = b.dr_number
        LEFT JOIN weeks_flagged w ON w.dr_number = b.dr_number AND w.note_code = b.note_code
       ORDER BY b.note_code, b.dr_number
       LIMIT $${limitIdx}
      `,
      params,
    );

    const output: ReconRow[] = rows.map((r) => {
      const classification = classify({
        oesSerial: r.oes_serial,
        ftSerial: r.ft_serial,
        lastFixSerial: r.last_fix_serial,
        lastFixAt: r.last_fix_at,
        oltRejected: r.olt_rejected,
      });
      return {
        drNumber: r.dr_number,
        noteCode: r.note_code,
        project: r.project,
        team: r.team,
        ftSerial: r.ft_serial,
        oesSerial: r.oes_serial,
        oesActivatedAt: r.oes_activated_at,
        lastFixSerial: r.last_fix_serial,
        lastFixAt: r.last_fix_at,
        oltRejected: r.olt_rejected,
        classification,
        weeksFlagged: Number(r.weeks_flagged ?? '0'),
        resolutionStatus: r.resolution_status,
        ticketUid: r.ticket_uid,
      };
    });

    const breakdown = output.reduce<Record<Classification, number>>(
      (acc, row) => {
        acc[row.classification] = (acc[row.classification] ?? 0) + 1;
        return acc;
      },
      {
        already_fixed_still_billed: 0,
        actionable: 0,
        blocked_no_installed: 0,
        no_oes: 0,
        unknown: 0,
      },
    );

    return apiResponse.success(res, {
      week: weekResolved,
      count: output.length,
      breakdown,
      rows: output,
    });
  } catch (err) {
    logger.error('recon failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

/** Classify a recon row using only local data (no live 1Map calls). */
function classify(input: {
  oesSerial: string | null;
  ftSerial: string | null;
  lastFixSerial: string | null;
  lastFixAt: string | null;
  oltRejected: boolean;
}): Classification {
  if (!input.oesSerial) return 'no_oes';
  if (input.lastFixSerial && input.lastFixAt) {
    // We wrote to 1Map at some point. If FT's billed serial still
    // disagrees, flag as dispute candidate.
    const fixedMatches = input.lastFixSerial.toUpperCase() === (input.oesSerial || '').toUpperCase();
    if (fixedMatches) return 'already_fixed_still_billed';
  }
  if (input.oltRejected) return 'blocked_no_installed';
  return 'actionable';
}

export default withAuth(handler);
