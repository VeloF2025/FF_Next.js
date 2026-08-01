/**
 * Nightly metrics snapshot.
 *
 * Captures point-in-time state that the upstream sources overwrite. This is the one
 * piece of the metrics platform with a clock on it: history accrues only from the
 * day this runs, and a night not captured cannot be reconstructed.
 *
 * GET /api/cron/metrics-snapshot            → snapshot today (SAST)
 * GET /api/cron/metrics-snapshot?date=YYYY-MM-DD → re-run a specific day
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { SNAPSHOT_SOURCES } from '@/modules/metrics/snapshot/sources';
import { writeSnapshot } from '@/modules/metrics/snapshot/writer';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // An unset secret must not authenticate. Without this guard the comparison
    // becomes `Bearer undefined === Bearer undefined`, so anyone sending the
    // literal string "Bearer undefined" is authorised wherever the var is missing.
    log.error('cronTask', { action: 'metrics-snapshot', error: 'CRON_SECRET not configured' });
    return apiResponse.internalError(res, new Error('CRON_SECRET not configured'));
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    log.error('cronTask', { action: 'metrics-snapshot', error: 'Unauthorized request' });
    return apiResponse.unauthorized(res);
  }

  // An explicit ?date= makes a missed or failed night re-runnable. Without it,
  // "absence of a completion row is the retry signal" has no consumer — the route
  // would only ever address today, so any night lost to a crash stays lost.
  const requested = req.query.date;
  if (requested !== undefined && (typeof requested !== 'string' || !ISO_DATE.test(requested))) {
    return apiResponse.badRequest(res, 'date must be YYYY-MM-DD');
  }
  // SAST date — the server runs UTC, and a UTC date would roll the snapshot at
  // 02:00 local, filing two hours of the new business day under yesterday.
  const asOf = requested ?? new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10);

  const client = await pool.connect();
  const results: Record<string, unknown> = {};
  const notWritten: string[] = [];
  try {
    for (const source of SNAPSHOT_SOURCES) {
      try {
        const result = await writeSnapshot(source.key, asOf, client);
        results[source.key] = result;
        // Not written means the day is not recorded — a lost lock race counts.
        // Reporting 200 here would show a green run over a missing snapshot.
        if (!result.written) notWritten.push(source.key);
      } catch (error) {
        // One bad source must not stop the others: a skipped day is unrecoverable,
        // so the remaining sources still get their chance.
        log.error('cronTask', {
          action: 'metrics-snapshot',
          sourceKey: source.key,
          asOf,
          error,
        });
        results[source.key] = { error: error instanceof Error ? error.message : String(error) };
        notWritten.push(source.key);
      }
    }
  } finally {
    client.release();
  }

  if (notWritten.length) {
    return apiResponse.internalError(
      res,
      new Error(`Snapshot sources not written: ${notWritten.join(', ')}`),
    );
  }
  return apiResponse.success(res, { asOf, results });
}
