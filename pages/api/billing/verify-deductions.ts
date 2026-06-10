/**
 * POST /api/billing/verify-deductions
 *
 * Runs the FT deduction auto-verifier (deductionVerdictService) on demand.
 *
 * Body (all optional):
 *   billing_week_id — verify one specific week row
 *   week_ending     — verify all project rows of that week (YYYY-MM-DD)
 *   project         — combined with week_ending, narrows to one project
 *   (empty body)    — verify every project row of the LATEST week_ending
 *
 * Verdicts persist on ft_billing_deductions; disputable rows appear in the
 * Action Centre Disputes "Candidates" view. Raising disputes stays manual.
 */

import type { NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import {
  computeVerdictsForWeek,
  type VerdictRunSummary,
} from '@/modules/billing/services/deductionVerdictService';

const logger = createLogger('api/billing/verify-deductions');

async function resolveWeekIds(body: {
  billing_week_id?: string;
  week_ending?: string;
  project?: string;
}): Promise<string[]> {
  if (body.billing_week_id) return [body.billing_week_id];

  if (body.week_ending) {
    const params: unknown[] = [body.week_ending];
    let sql = `SELECT id FROM ft_weekly_billing WHERE week_ending = $1::date`;
    if (body.project) {
      params.push(body.project);
      sql += ` AND project ILIKE $2`;
    }
    const { rows } = await pool.query<{ id: string }>(sql, params);
    return rows.map((r) => r.id);
  }

  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM ft_weekly_billing
      WHERE week_ending = (SELECT MAX(week_ending) FROM ft_weekly_billing)`,
  );
  return rows.map((r) => r.id);
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const body = (req.body ?? {}) as {
    billing_week_id?: string;
    week_ending?: string;
    project?: string;
  };

  try {
    const weekIds = await resolveWeekIds(body);
    if (weekIds.length === 0) {
      return apiResponse.badRequest(res, 'No billing weeks match the given criteria');
    }

    const summaries: VerdictRunSummary[] = [];
    for (const id of weekIds) {
      summaries.push(await computeVerdictsForWeek(id));
    }

    const totals = summaries.reduce(
      (acc, s) => ({
        total: acc.total + s.total,
        judged: acc.judged + s.judged,
        disputable: acc.disputable + s.disputable,
        legitimate: acc.legitimate + s.legitimate,
        insufficientEvidence: acc.insufficientEvidence + s.insufficientEvidence,
        skipped: acc.skipped + s.skipped,
      }),
      { total: 0, judged: 0, disputable: 0, legitimate: 0, insufficientEvidence: 0, skipped: 0 },
    );

    logger.info('verify-deductions complete', { weeks: weekIds.length, ...totals });
    return apiResponse.success(res, { weeks: summaries, totals });
  } catch (err) {
    logger.error('verify-deductions failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler as Parameters<typeof withAuth>[0]);
