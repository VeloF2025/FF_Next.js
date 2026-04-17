/**
 * GET /api/activate/action-centre/rule-runs
 *
 * Returns operator-facing visibility into the rule engine and recon
 * cron:
 *   - Recent rule_runs (ordered by started_at DESC)
 *   - Per-rule watermark (from action_centre_rule_checkpoints)
 *   - Aggregate totals for the last 24h (events processed, actions taken)
 *   - Error count across recent runs
 *
 * Query params:
 *   limit — default 20, max 100
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/activate/action-centre/rule-runs');

interface RuleRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  dryRun: boolean;
  eventsProcessed: number;
  actionsTaken: number;
  rulesSummary: Record<string, { processed: number; actions: number }>;
  errors: Array<{ rule: string; message: string }>;
}

interface Checkpoint {
  ruleName: string;
  lastEventAt: string | null;
  updatedAt: string;
}

interface Payload {
  recentRuns: RuleRun[];
  checkpoints: Checkpoint[];
  last24h: {
    runs: number;
    eventsProcessed: number;
    actionsTaken: number;
    runsWithErrors: number;
    dryRuns: number;
  };
}

async function safe<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    logger.warn('rule-runs query failed', {
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

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  try {
    const [recentRuns, checkpoints, last24h] = await Promise.all([
      safe('recentRuns', async () => {
        const { rows } = await pool.query<{
          id: string; started_at: string; completed_at: string | null;
          dry_run: boolean; events_processed: string; actions_taken: string;
          rules_summary: Record<string, { processed: number; actions: number }>;
          errors: Array<{ rule: string; message: string }>;
        }>(
          `SELECT id::text, started_at::text, completed_at::text,
                  dry_run, events_processed::text, actions_taken::text,
                  rules_summary, errors
             FROM action_centre_rule_runs
            ORDER BY started_at DESC
            LIMIT $1`,
          [limit],
        );
        return rows.map((r): RuleRun => ({
          id: r.id,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          dryRun: r.dry_run,
          eventsProcessed: Number(r.events_processed),
          actionsTaken: Number(r.actions_taken),
          rulesSummary: r.rules_summary ?? {},
          errors: r.errors ?? [],
        }));
      }, [] as RuleRun[]),

      safe('checkpoints', async () => {
        const { rows } = await pool.query<{
          rule_name: string; last_event_at: string | null; updated_at: string;
        }>(
          `SELECT rule_name, last_event_at::text, updated_at::text
             FROM action_centre_rule_checkpoints
            ORDER BY rule_name`,
        );
        return rows.map((r): Checkpoint => ({
          ruleName: r.rule_name,
          lastEventAt: r.last_event_at,
          updatedAt: r.updated_at,
        }));
      }, [] as Checkpoint[]),

      safe('last24h', async () => {
        const { rows } = await pool.query<{
          runs: string; events_processed: string; actions_taken: string;
          runs_with_errors: string; dry_runs: string;
        }>(
          `SELECT COUNT(*)::text AS runs,
                  COALESCE(SUM(events_processed),0)::text AS events_processed,
                  COALESCE(SUM(actions_taken),0)::text    AS actions_taken,
                  COUNT(*) FILTER (WHERE jsonb_array_length(errors) > 0)::text AS runs_with_errors,
                  COUNT(*) FILTER (WHERE dry_run)::text AS dry_runs
             FROM action_centre_rule_runs
            WHERE started_at > NOW() - INTERVAL '24 hours'`,
        );
        const r = rows[0];
        return {
          runs: Number(r?.runs ?? 0),
          eventsProcessed: Number(r?.events_processed ?? 0),
          actionsTaken: Number(r?.actions_taken ?? 0),
          runsWithErrors: Number(r?.runs_with_errors ?? 0),
          dryRuns: Number(r?.dry_runs ?? 0),
        };
      }, { runs: 0, eventsProcessed: 0, actionsTaken: 0, runsWithErrors: 0, dryRuns: 0 }),
    ]);

    const payload: Payload = { recentRuns, checkpoints, last24h };
    return apiResponse.success(res, payload);
  } catch (err) {
    logger.error('rule-runs failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
