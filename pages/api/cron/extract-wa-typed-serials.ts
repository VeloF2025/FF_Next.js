/**
 * POST /api/cron/extract-wa-typed-serials
 *
 * Protected cron endpoint — parses TYPED ONT/UPS serials out of
 * dr_photo_unified_reviews.wa_original_text into wa_typed_ont_serial /
 * wa_typed_ups_serial so the three-way reconciliation ledger's WA leg can fall back
 * to a serial a technician merely TYPED (audit rec #5, part A).
 *
 * Authentication: x-cron-secret: {CRON_SECRET} (same as the OES nightly report).
 *
 * Idempotent + self-backfilling — each row is parsed exactly once
 * (wa_typed_serial_extracted_at marker). To DRAIN the historical backlog, call with
 * a large { "limit": 50000 } once; the nightly run then only sees fresh DRs.
 *
 * Suggested crontab on velo (after the 22:30 OES sync, before the 07:00 report):
 *   5 6 * * * curl -s -X POST http://localhost:3000/api/cron/extract-wa-typed-serials \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Optional body: { "limit": <1..50000> } (default 5000).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { populateTypedSerials } from '@/modules/data-sync/services/typedSerialPopulator';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', {}, 'extract-wa-typed-serials');
    return apiResponse.internalError(res, new Error('Server misconfiguration'));
  }

  if (req.headers['x-cron-secret'] !== cronSecret) {
    log.warn('Unauthorised typed-serial extract attempt', {
      ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? ''),
    }, 'extract-wa-typed-serials');
    return apiResponse.unauthorized(res, 'Invalid or missing x-cron-secret header');
  }

  const rawLimit = req.body?.limit;
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : undefined;

  try {
    // populateTypedSerials already logs the run summary; avoid a duplicate line here.
    const result = await populateTypedSerials(limit);
    return apiResponse.success(res, result, 'Typed serials extracted');
  } catch (error: unknown) {
    log.error('typed-serial extract failed', {
      error: error instanceof Error ? error.message : String(error),
    }, 'extract-wa-typed-serials');
    return apiResponse.internalError(res, error, 'Typed-serial extraction failed');
  }
}
