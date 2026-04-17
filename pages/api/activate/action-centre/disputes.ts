/**
 * Action Centre — Disputes
 *
 * GET  /api/activate/action-centre/disputes
 *   Returns ft_billing_deductions rows with resolution_status IN
 *   ('disputing', 'disputed', 'acknowledged') plus enrichment: latest
 *   OES serial, last 1Map fix, linked ticket.
 *
 * POST /api/activate/action-centre/disputes
 *   Body: { deductionId, action: 'raise'|'mark_outcome'|'withdraw', outcome?, reason? }
 *   Flips resolution_status + records the change on ft_billing_deductions
 *   and emits a non_invoiceable_resolved event when outcome is set.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import {
  logNonInvoiceableResolved,
  type NoteCode,
} from '@/modules/activate/services/activity-log/eventLoggers';

const logger = createLogger('api/activate/action-centre/disputes');

const DISPUTE_STATUSES = ['disputing', 'disputed', 'acknowledged'];

interface DisputeRow {
  deductionId: string;
  drNumber: string;
  noteCode: string;
  project: string | null;
  team: string | null;
  weekEnding: string;
  ftSerial: string | null;
  oesSerial: string | null;
  oesActivatedAt: string | null;
  lastFixSerial: string | null;
  lastFixAt: string | null;
  ticketId: string | null;
  ticketUid: string | null;
  resolutionStatus: string;
  disputeReason: string | null;
  disputeOutcome: string | null;
  disputeOpenedAt: string | null;
  weeksFlagged: number;
}

async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const project = typeof req.query.project === 'string' ? req.query.project.trim() : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
  const outcome = typeof req.query.outcome === 'string' ? req.query.outcome.trim() : null;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

  const params: unknown[] = [DISPUTE_STATUSES];
  const clauses: string[] = [`d.resolution_status = ANY($1::text[])`];

  if (project) {
    params.push(project);
    clauses.push(`d.project ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(d.dr_number ILIKE $${params.length} OR d.serial_number ILIKE $${params.length})`);
  }
  if (outcome) {
    if (outcome === 'none') {
      clauses.push(`d.dispute_outcome IS NULL`);
    } else {
      params.push(outcome);
      clauses.push(`d.dispute_outcome = $${params.length}`);
    }
  }

  params.push(limit);
  const limitIdx = params.length;

  try {
    const { rows } = await pool.query<{
      id: string; dr_number: string; deduction_note: string; project: string | null;
      team: string | null; week_ending: string; serial_number: string | null;
      resolution_status: string; dispute_reason: string | null;
      dispute_outcome: string | null; dispute_opened_at: string | null;
      ticket_id: string | null; ticket_uid: string | null;
      oes_serial: string | null; oes_activated_at: string | null;
      last_fix_serial: string | null; last_fix_at: string | null;
      weeks_flagged: string;
    }>(
      `
      WITH latest_oes AS (
        SELECT DISTINCT ON (drop_number) drop_number, serial_number, activation_date
          FROM oes_activations
         ORDER BY drop_number, COALESCE(activation_datetime, created_at) DESC
      ),
      last_fix AS (
        SELECT DISTINCT ON (drop_number) drop_number, new_value AS last_fix_serial, created_at AS last_fix_at
          FROM serial_change_history
         WHERE change_source = 'olt_report_fix' AND change_type = 'ont_serial'
         ORDER BY drop_number, created_at DESC
      )
      SELECT d.id, d.dr_number, d.deduction_note, d.project, d.team,
             d.week_ending::text, d.serial_number,
             d.resolution_status, d.dispute_reason, d.dispute_outcome,
             d.dispute_opened_at::text,
             d.ticket_id, t.ticket_uid,
             o.serial_number       AS oes_serial,
             o.activation_date::text AS oes_activated_at,
             f.last_fix_serial,
             f.last_fix_at::text,
             (SELECT COUNT(DISTINCT week_ending)
                FROM ft_billing_deductions
               WHERE dr_number = d.dr_number AND deduction_note = d.deduction_note)::text AS weeks_flagged
        FROM ft_billing_deductions d
        LEFT JOIN maintenance_tickets t ON t.id = d.ticket_id
        LEFT JOIN latest_oes o           ON o.drop_number = d.dr_number
        LEFT JOIN last_fix f             ON f.drop_number = d.dr_number
       WHERE ${clauses.join(' AND ')}
       ORDER BY d.dispute_opened_at DESC NULLS LAST, d.week_ending DESC, d.dr_number
       LIMIT $${limitIdx}
      `,
      params,
    );

    const items: DisputeRow[] = rows.map((r) => ({
      deductionId: r.id,
      drNumber: r.dr_number,
      noteCode: r.deduction_note,
      project: r.project,
      team: r.team,
      weekEnding: r.week_ending,
      ftSerial: r.serial_number,
      oesSerial: r.oes_serial,
      oesActivatedAt: r.oes_activated_at,
      lastFixSerial: r.last_fix_serial,
      lastFixAt: r.last_fix_at,
      ticketId: r.ticket_id,
      ticketUid: r.ticket_uid,
      resolutionStatus: r.resolution_status,
      disputeReason: r.dispute_reason,
      disputeOutcome: r.dispute_outcome,
      disputeOpenedAt: r.dispute_opened_at,
      weeksFlagged: Number(r.weeks_flagged ?? '0'),
    }));

    const breakdown = {
      disputing: items.filter((x) => x.resolutionStatus === 'disputing').length,
      disputed: items.filter((x) => x.resolutionStatus === 'disputed').length,
      acknowledged: items.filter((x) => x.resolutionStatus === 'acknowledged').length,
      won: items.filter((x) => x.disputeOutcome === 'won').length,
      lost: items.filter((x) => x.disputeOutcome === 'lost').length,
      no_outcome: items.filter((x) => !x.disputeOutcome).length,
    };

    return apiResponse.success(res, {
      count: items.length,
      breakdown,
      items,
    });
  } catch (err) {
    logger.error('disputes GET failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const body = req.body as {
    deductionId?: string;
    action?: 'raise' | 'mark_outcome' | 'withdraw';
    outcome?: 'won' | 'lost' | 'partial' | null;
    reason?: string;
  };

  if (!body.deductionId || !body.action) {
    return apiResponse.badRequest(res, 'deductionId and action are required');
  }

  try {
    const { rows: current } = await pool.query<{
      dr_number: string; deduction_note: string; week_ending: string;
      resolution_status: string;
    }>(
      `SELECT dr_number, deduction_note, week_ending::text, resolution_status
         FROM ft_billing_deductions WHERE id = $1`,
      [body.deductionId],
    );
    const row = current[0];
    if (!row) return apiResponse.notFound(res, 'Deduction', body.deductionId);

    let targetStatus: string;
    let emitResolution = false;
    let resolvedReason: string | null = body.reason ?? null;

    switch (body.action) {
      case 'raise':
        targetStatus = 'disputing';
        break;
      case 'mark_outcome':
        if (!body.outcome || !['won', 'lost', 'partial'].includes(body.outcome)) {
          return apiResponse.badRequest(res, 'mark_outcome requires outcome in (won|lost|partial)');
        }
        targetStatus = body.outcome === 'won' ? 'resolved' : 'disputed';
        emitResolution = body.outcome === 'won';
        resolvedReason = resolvedReason ?? `dispute ${body.outcome}`;
        break;
      case 'withdraw':
        targetStatus = 'open';
        break;
      default:
        return apiResponse.badRequest(res, `Unknown action ${body.action}`);
    }

    const { rows: updated } = await pool.query<{
      id: string; dr_number: string; deduction_note: string; week_ending: string;
    }>(
      `UPDATE ft_billing_deductions
          SET resolution_status  = $2,
              dispute_outcome    = $3,
              dispute_reason     = COALESCE(NULLIF($4, ''), dispute_reason),
              dispute_opened_at  = CASE
                                     WHEN $2 = 'disputing' AND dispute_opened_at IS NULL THEN NOW()
                                     ELSE dispute_opened_at
                                   END,
              resolved_at        = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END,
              resolved_reason    = CASE WHEN $2 = 'resolved' THEN COALESCE($4, 'dispute won') ELSE resolved_reason END
        WHERE id = $1
        RETURNING id, dr_number, deduction_note, week_ending::text`,
      [body.deductionId, targetStatus, body.outcome ?? null, body.reason ?? null],
    );
    const u = updated[0]!;

    // Emit timeline event when marking a dispute as won (resolved)
    if (emitResolution) {
      try {
        await logNonInvoiceableResolved(
          u.dr_number,
          {
            weekEnding: u.week_ending,
            noteCode: u.deduction_note as NoteCode,
            resolutionReason: resolvedReason ?? 'dispute_won',
            disputeOutcome: body.outcome ?? null,
          },
          'disputes-tab',
        );
      } catch (err) {
        logger.warn('failed to emit non_invoiceable_resolved', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return apiResponse.success(res, {
      id: u.id,
      drNumber: u.dr_number,
      noteCode: u.deduction_note,
      weekEnding: u.week_ending,
      newStatus: targetStatus,
      previousStatus: row.resolution_status,
      outcome: body.outcome ?? null,
    });
  } catch (err) {
    logger.error('disputes POST failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

export default withAuth(handler);
