/**
 * Vercel Cron: Action Centre rule engine
 *
 * RFC Phase 3 — docs/rfcs/2026-04-17-action-centre-and-dr-timeline.md §5.4
 *
 * Reads dr_activity_log events since the last per-rule watermark and applies
 * rules: auto-close pre-prov tickets on activation, auto-close N4 tickets on
 * 1Map reconciliation, emit dispute candidates when N4 flags a DR we already
 * fixed.
 *
 * Query params:
 *   dryRun=true → runs rules without mutating state; summary still reports
 *                 "would have closed" counts.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { runActionCentreRules } from '@/modules/activate/services/action-centre-rules/ruleEngine';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('cronTask', { action: 'action-centre-rules', error: 'CRON_SECRET not configured' });
    return apiResponse.internalError(res, new Error('CRON_SECRET not configured'));
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    log.error('cronTask', { action: 'action-centre-rules', error: 'Unauthorized request' });
    return apiResponse.unauthorized(res);
  }

  const dryRun = String(req.query.dryRun || '').toLowerCase() === 'true';
  log.info('cronTask', { action: 'action-centre-rules', step: 'start', dryRun });

  try {
    const summary = await runActionCentreRules(dryRun);
    log.info('cronTask', { action: 'action-centre-rules', step: 'done', summary });
    return apiResponse.success(res, summary);
  } catch (err) {
    log.error('cronTask', {
      action: 'action-centre-rules',
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}
