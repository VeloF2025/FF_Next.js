/**
 * POST /api/cron/wa-no-oes-tickets
 *
 * Protected cron endpoint — creates auto-assigned `activations` NOC tickets for
 * DRs that were submitted on WhatsApp but never activated
 * (v_dr_reconciliation_ledger.recon_class = 'wa_no_oes'), and auto-resolves those
 * tickets once the DR later gains an OES activation (audit rec #5, part B).
 *
 * Authentication: x-cron-secret: {CRON_SECRET} (same as the OES nightly report).
 *
 * Body (all optional):
 *   { "project": "Mohadin",   // restrict to one project name (gated backfill)
 *     "sinceDays": 30,         // window; null = no window (full backfill)
 *     "dryRun": true,          // report what WOULD be created — no inserts/resolves
 *     "limit": 1000 }          // cap rows scanned (1..5000)
 *
 * Defaults: no project filter, sinceDays = 30 (forward window), dryRun = false.
 * Omit `sinceDays` for the nightly forward run; send `"sinceDays": null` (+ a
 * `project`) for the deliberate per-project historical backfill.
 *
 * Suggested crontab on velo (after the 06:05 typed-serial cron, before the 07:00
 * OES report):
 *   10 6 * * * curl -s -X POST http://localhost:3000/api/cron/wa-no-oes-tickets \
 *     -H "x-cron-secret: $CRON_SECRET"
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  runWaNoOesTickets,
  autoResolveWaNoOesTickets,
} from '@/modules/data-sync/services/waNoOesTicketService';

/** Forward window (days) used when the caller does not specify `sinceDays`. */
const DEFAULT_FORWARD_DAYS = 30;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', {}, 'wa-no-oes-tickets');
    return apiResponse.internalError(res, new Error('Server misconfiguration'));
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    log.warn(
      'Unauthorised wa-no-oes-tickets attempt',
      { ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '') },
      'wa-no-oes-tickets'
    );
    return apiResponse.unauthorized(res, 'Invalid or missing x-cron-secret header');
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectName = typeof body.project === 'string' && body.project.trim() ? body.project.trim() : null;
  const dryRun = body.dryRun === true;
  const rawLimit = body.limit;
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : undefined;

  // `sinceDays` present (incl. explicit null) is taken verbatim; absent → forward window.
  const hasSince = Object.prototype.hasOwnProperty.call(body, 'sinceDays');
  const rawSince = body.sinceDays;
  const sinceDays = hasSince
    ? rawSince === null
      ? null
      : typeof rawSince === 'number' && Number.isFinite(rawSince)
        ? rawSince
        : DEFAULT_FORWARD_DAYS
    : DEFAULT_FORWARD_DAYS;

  try {
    const run = await runWaNoOesTickets({ projectName, sinceDays, limit, dryRun });
    // Resolve stale tickets only on a real run — never mutate during a dry-run.
    const resolved = dryRun ? 0 : await autoResolveWaNoOesTickets();
    return apiResponse.success(
      res,
      { ...run, resolved },
      dryRun ? 'wa_no_oes dry-run complete' : 'wa_no_oes tickets processed'
    );
  } catch (error: unknown) {
    log.error(
      'wa-no-oes-tickets run failed',
      { error: error instanceof Error ? error.message : String(error) },
      'wa-no-oes-tickets'
    );
    return apiResponse.internalError(res, error, 'wa_no_oes ticket run failed');
  }
}
