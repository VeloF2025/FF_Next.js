/**
 * GET /api/activate/action-centre/overview
 *
 * One-shot aggregated counts for the Action Centre landing page (RFC Phase 5).
 * Runs independent counts in parallel; each count falls back to 0 on error
 * so a single bad table never blanks the whole dashboard.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/activate/action-centre/overview');

interface ActionCentreOverview {
  generatedAt: string;
  deductions: {
    latestWeek: string | null;
    openByNote: Record<string, number>;
    ticketed: number;
    resolvedThisMonth: number;
    disputing: number;
  };
  preProv: {
    outstanding: number;
    withTicket: number;
    resolvedThisMonth: number;
  };
  tickets: {
    open: number;
    autoClosedToday: number;
  };
  anomalies: {
    fixedStillBilled: number;
    persistentNote: number;
  };
  recentRuleRun: {
    startedAt: string | null;
    eventsProcessed: number;
    actionsTaken: number;
    dryRun: boolean;
  } | null;
}

/** Run a query and tolerate failure — the dashboard must not 500 on one slow table. */
async function safeQuery<R>(label: string, runner: () => Promise<R>, fallback: R): Promise<R> {
  try {
    return await runner();
  } catch (err) {
    logger.warn('overview query failed — returning fallback', {
      label,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const [
      latestWeek,
      deductionsByNote,
      deductionStatusCounts,
      resolvedMonthCount,
      ppCounts,
      ppResolvedMonth,
      ticketCounts,
      autoClosedToday,
      anomalyCounts,
      lastRun,
    ] = await Promise.all([
      safeQuery('latestWeek', async () => {
        const { rows } = await pool.query<{ week_ending: string }>(
          `SELECT MAX(week_ending)::text AS week_ending FROM ft_billing_deductions`,
        );
        return rows[0]?.week_ending ?? null;
      }, null),

      safeQuery('deductionsByNote', async () => {
        const { rows } = await pool.query<{ deduction_note: string; cnt: string }>(
          `SELECT deduction_note, COUNT(*)::text AS cnt
             FROM ft_billing_deductions
            WHERE resolution_status = 'open'
              AND week_ending = (SELECT MAX(week_ending) FROM ft_billing_deductions)
            GROUP BY deduction_note`,
        );
        const map: Record<string, number> = {};
        for (const r of rows) map[r.deduction_note] = Number(r.cnt);
        return map;
      }, {} as Record<string, number>),

      safeQuery('deductionStatusCounts', async () => {
        const { rows } = await pool.query<{ ticketed: string; disputing: string }>(
          `SELECT
              COUNT(*) FILTER (WHERE resolution_status='ticketed')::text AS ticketed,
              COUNT(*) FILTER (WHERE resolution_status='disputing')::text AS disputing
           FROM ft_billing_deductions
           WHERE week_ending = (SELECT MAX(week_ending) FROM ft_billing_deductions)`,
        );
        return {
          ticketed: Number(rows[0]?.ticketed ?? 0),
          disputing: Number(rows[0]?.disputing ?? 0),
        };
      }, { ticketed: 0, disputing: 0 }),

      safeQuery('resolvedMonthCount', async () => {
        const { rows } = await pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM ft_billing_deductions
            WHERE resolution_status IN ('resolved','auto_closed')
              AND resolved_at >= date_trunc('month', NOW())`,
        );
        return Number(rows[0]?.cnt ?? 0);
      }, 0),

      safeQuery('ppCounts', async () => {
        const { rows } = await pool.query<{ outstanding: string; ticketed: string }>(
          `SELECT
              COUNT(*) FILTER (WHERE resolution_status <> 'activated' OR resolution_status IS NULL)::text AS outstanding,
              COUNT(*) FILTER (WHERE ticket_id IS NOT NULL AND (resolution_status <> 'activated' OR resolution_status IS NULL))::text AS ticketed
           FROM oes_pp_data`,
        );
        return {
          outstanding: Number(rows[0]?.outstanding ?? 0),
          withTicket: Number(rows[0]?.ticketed ?? 0),
        };
      }, { outstanding: 0, withTicket: 0 }),

      safeQuery('ppResolvedMonth', async () => {
        const { rows } = await pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM oes_pp_data
            WHERE resolution_status = 'activated'
              AND resolved_at >= date_trunc('month', NOW())`,
        );
        return Number(rows[0]?.cnt ?? 0);
      }, 0),

      safeQuery('ticketCounts', async () => {
        const { rows } = await pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM maintenance_tickets
            WHERE status NOT IN ('closed','cancelled','resolved','verified','qa_approved')`,
        );
        return Number(rows[0]?.cnt ?? 0);
      }, 0),

      safeQuery('autoClosedToday', async () => {
        const { rows } = await pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM dr_activity_log
            WHERE event_type = 'ticket_auto_closed'
              AND created_at >= date_trunc('day', NOW())`,
        );
        return Number(rows[0]?.cnt ?? 0);
      }, 0),

      safeQuery('anomalyCounts', async () => {
        const { rows } = await pool.query<{ fixed_still: string; persistent: string }>(
          `SELECT
             COUNT(*) FILTER (WHERE event_type='anomaly_fixed_still_billed' AND created_at >= NOW() - INTERVAL '7 days')::text AS fixed_still,
             COUNT(*) FILTER (WHERE event_type='anomaly_persistent_note'   AND created_at >= NOW() - INTERVAL '7 days')::text AS persistent
           FROM dr_activity_log`,
        );
        return {
          fixedStillBilled: Number(rows[0]?.fixed_still ?? 0),
          persistentNote: Number(rows[0]?.persistent ?? 0),
        };
      }, { fixedStillBilled: 0, persistentNote: 0 }),

      safeQuery('lastRun', async () => {
        const { rows } = await pool.query<{
          started_at: string; events_processed: string; actions_taken: string; dry_run: boolean;
        }>(
          `SELECT started_at::text, events_processed::text, actions_taken::text, dry_run
             FROM action_centre_rule_runs
            ORDER BY started_at DESC LIMIT 1`,
        );
        if (rows.length === 0) return null;
        const r = rows[0]!;
        return {
          startedAt: r.started_at,
          eventsProcessed: Number(r.events_processed),
          actionsTaken: Number(r.actions_taken),
          dryRun: r.dry_run,
        };
      }, null),
    ]);

    const payload: ActionCentreOverview = {
      generatedAt: new Date().toISOString(),
      deductions: {
        latestWeek,
        openByNote: deductionsByNote,
        ticketed: deductionStatusCounts.ticketed,
        disputing: deductionStatusCounts.disputing,
        resolvedThisMonth: resolvedMonthCount,
      },
      preProv: {
        outstanding: ppCounts.outstanding,
        withTicket: ppCounts.withTicket,
        resolvedThisMonth: ppResolvedMonth,
      },
      tickets: {
        open: ticketCounts,
        autoClosedToday,
      },
      anomalies: anomalyCounts,
      recentRuleRun: lastRun,
    };

    return apiResponse.success(res, payload);
  } catch (err) {
    logger.error('overview failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
