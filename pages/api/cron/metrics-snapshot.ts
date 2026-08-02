/**
 * Nightly metrics snapshot.
 *
 * Captures point-in-time state that the upstream sources overwrite. This is the one
 * piece of the metrics platform with a clock on it: history accrues only from the
 * day this runs, and a night not captured cannot be reconstructed.
 *
 * GET /api/cron/metrics-snapshot                 → snapshot today (SAST)
 * GET /api/cron/metrics-snapshot?date=<today>    → same-day retry (must equal today)
 *
 * There is deliberately NO backfill. The sources read CURRENT state — the open PP
 * list and open tickets as they are right now — so labelling that state with a past
 * date would fabricate history: an August run with a July date would record August's
 * open entities as July's, and write a completion row that permanently blocks the
 * real July capture. A night that was missed cannot be reconstructed from mutable
 * sources; that is a property of the data, not a gap here. `?date=` exists only so a
 * failed run can be retried within the same SAST day.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { SNAPSHOT_SOURCES } from '@/modules/metrics/snapshot/sources';
import { writeSnapshot } from '@/modules/metrics/snapshot/writer';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // This route mutates state, so it must not answer to arbitrary verbs.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }

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

  // SAST date — the server runs UTC, and a UTC date would roll the snapshot at
  // 02:00 local, filing two hours of the new business day under yesterday.
  const today = new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10);

  const requested = req.query.date;
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !ISO_DATE.test(requested)) {
      return apiResponse.badRequest(res, 'date must be YYYY-MM-DD');
    }
    // Same-day retry only. Backdating would snapshot today's live state under a
    // past date and write a completion row that blocks the real day forever.
    // Forward-dating would fabricate a future record. See the file header.
    if (requested !== today) {
      return apiResponse.badRequest(
        res,
        `date must be today in SAST (${today}); these sources hold current state only, ` +
          `so a past or future date would record fabricated history`,
      );
    }
  }
  const asOf = today;

  const results: Record<string, unknown> = {};
  const notWritten: string[] = [];

  // Inside the try so a pool failure returns the standard envelope and is logged,
  // rather than escaping as an unhandled rejection.
  //
  // Typed as PoolClient explicitly: pg's `connect` is overloaded (promise form and
  // callback form), and `ReturnType<typeof pool.connect>` resolves to the LAST
  // overload — `void` — which then poisons every use of `client` below.
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    log.error('cronTask', { action: 'metrics-snapshot', asOf, error });
    return apiResponse.internalError(res, error, 'Could not acquire a database connection');
  }

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
