/**
 * Action Centre — Disputes
 *
 * GET  /api/activate/action-centre/disputes
 *   Default view: ft_billing_deductions rows with resolution_status IN
 *   ('disputing', 'disputed', 'acknowledged') plus enrichment: latest
 *   OES serial, last 1Map fix, linked ticket.
 *   view=candidates: rows the auto-verifier judged 'disputable' that have
 *   NOT been raised yet (resolution_status open/in_progress/ticketed) —
 *   the human review queue for raising disputes.
 *
 * POST /api/activate/action-centre/disputes
 *   Body: { deductionId | deductionIds[], action: 'raise'|'mark_outcome'|'withdraw', outcome?, reason? }
 *   Lifecycle writes live in disputeActions.ts (incl. oes_activations
 *   payment_status sync + non_invoiceable_resolved event on win).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import {
  applyDisputeAction,
  applyDisputeActionBulk,
  type DisputeAction,
  type DisputeOutcome,
} from '@/modules/activate/services/disputeActions';

const logger = createLogger('api/activate/action-centre/disputes');

const DISPUTE_STATUSES = ['disputing', 'disputed', 'acknowledged'];
const CANDIDATE_STATUSES = ['open', 'in_progress', 'ticketed'];

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
  verdict: string | null;
  verdictReasons: string[];
  verdictComputedAt: string | null;
}

async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const view = req.query.view === 'candidates' ? 'candidates' : 'disputes';
  const project = typeof req.query.project === 'string' ? req.query.project.trim() : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
  const outcome = typeof req.query.outcome === 'string' ? req.query.outcome.trim() : null;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

  const params: unknown[] = [];
  const clauses: string[] = [];

  if (view === 'candidates') {
    params.push(CANDIDATE_STATUSES);
    clauses.push(`d.resolution_status = ANY($1::text[])`);
    clauses.push(`d.verdict = 'disputable'`);
  } else {
    params.push(DISPUTE_STATUSES);
    clauses.push(`d.resolution_status = ANY($1::text[])`);
  }

  if (project) {
    params.push(project);
    clauses.push(`d.project ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(d.dr_number ILIKE $${params.length} OR d.serial_number ILIKE $${params.length})`);
  }
  if (outcome && view === 'disputes') {
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
      verdict: string | null; verdict_reasons: string | null;
      verdict_computed_at: string | null;
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
             d.verdict,
             d.verdict_evidence->>'reasons' AS verdict_reasons,
             d.verdict_computed_at::text,
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
      verdict: r.verdict,
      verdictReasons: parseReasons(r.verdict_reasons),
      verdictComputedAt: r.verdict_computed_at,
    }));

    const breakdown = {
      disputing: items.filter((x) => x.resolutionStatus === 'disputing').length,
      disputed: items.filter((x) => x.resolutionStatus === 'disputed').length,
      acknowledged: items.filter((x) => x.resolutionStatus === 'acknowledged').length,
      won: items.filter((x) => x.disputeOutcome === 'won').length,
      lost: items.filter((x) => x.disputeOutcome === 'lost').length,
      no_outcome: items.filter((x) => !x.disputeOutcome).length,
    };

    const byNote = items.reduce<Record<string, number>>((acc, i) => {
      acc[i.noteCode] = (acc[i.noteCode] ?? 0) + 1;
      return acc;
    }, {});

    return apiResponse.success(res, {
      view,
      count: items.length,
      breakdown,
      byNote,
      items,
    });
  } catch (err) {
    logger.error('disputes GET failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

function parseReasons(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (err) {
    logger.warn('unparseable verdict reasons', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const body = req.body as {
    deductionId?: string;
    deductionIds?: string[];
    action?: DisputeAction;
    outcome?: DisputeOutcome | null;
    reason?: string;
  };

  const ids = Array.isArray(body.deductionIds) && body.deductionIds.length > 0
    ? body.deductionIds
    : body.deductionId ? [body.deductionId] : [];

  if (ids.length === 0 || !body.action) {
    return apiResponse.badRequest(res, 'deductionId (or deductionIds[]) and action are required');
  }

  try {
    if (ids.length === 1) {
      const result = await applyDisputeAction({
        deductionId: ids[0]!,
        action: body.action,
        outcome: body.outcome ?? null,
        reason: body.reason ?? null,
      });
      return apiResponse.success(res, result);
    }

    const { results, failures } = await applyDisputeActionBulk({
      deductionIds: ids,
      action: body.action,
      outcome: body.outcome ?? null,
      reason: body.reason ?? null,
    });
    return apiResponse.success(res, {
      applied: results.length,
      failed: failures.length,
      results,
      failures,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(message)) return apiResponse.notFound(res, 'Deduction', ids[0]!);
    if (/requires outcome|Unknown action/.test(message)) return apiResponse.badRequest(res, message);
    logger.error('disputes POST failed', { error: message });
    return apiResponse.internalError(res, err);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

export default withAuth(handler);
