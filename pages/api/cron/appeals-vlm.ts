import type { NextApiRequest, NextApiResponse } from 'next';
import type { PoolClient } from 'pg';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { findPendingAppeals, isAutoDecideEnabled } from '@/modules/sitecam/services/appealsVlmStore';
import { processAppeal } from '@/modules/sitecam/services/appealsVlmRunner';

const MODULE = 'AppealsVlmCron';
const BATCH_LIMIT = 10;
// A transient VLM outage retries until this cap, then findPendingAppeals parks the row.
const MAX_ATTEMPTS = 3;
// Serialise overlapping ticks. A slow/backlogged batch (10 × a slow VLM) can exceed
// the 5-min schedule; findPendingAppeals takes no row lock, so a second tick would
// re-select and double-score the same in-flight rows. A session-level *try*-lock
// skips the tick when another run holds it — non-blocking, and not an xact lock, so
// we never pin a connection in an open transaction across the slow VLM calls.
const CRON_LOCK_NAME = 'sitecam-appeals-vlm-cron';

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', undefined, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: CRON_SECRET not set');
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return apiResponse.unauthorized(res, 'Invalid or missing cron secret');
  }

  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await pool.connect();
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [CRON_LOCK_NAME],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) {
      log.info('Another appeals-VLM run holds the lock — skipping this tick', undefined, MODULE);
      return apiResponse.success(res, { processed: 0, scored: 0, retried: 0, skipped: true });
    }

    // Resolved once per tick: OFF/absent → advisory shadow mode; ON → auto-decide
    // clear approve/deny above the confidence + gallery-cross-reference bar.
    const autoDecide = await isAutoDecideEnabled();
    const appeals = await findPendingAppeals(BATCH_LIMIT, MAX_ATTEMPTS);
    log.info(`Appeals VLM: ${appeals.length} pending (autoDecide=${autoDecide})`, undefined, MODULE);

    let scored = 0;
    let retried = 0;
    let autoDecided = 0;

    for (const appeal of appeals) {
      try {
        const outcome = await processAppeal(appeal, autoDecide);
        if (outcome === 'auto_decided') autoDecided++;
        else if (outcome === 'scored') scored++;
        else if (outcome === 'retried') retried++;
      } catch (err) {
        log.error(`Unexpected error scoring appeal ${appeal.id}`, { err: String(err) }, MODULE);
      }
    }

    return apiResponse.success(res, {
      processed: appeals.length,
      scored,
      autoDecided,
      retried,
      skipped: false,
    });
  } catch (err) {
    log.error('Appeals VLM cron failed', { err: String(err) }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Appeals VLM cron failed');
  } finally {
    if (client) {
      if (locked) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [CRON_LOCK_NAME]);
          client.release();
        } catch (unlockErr) {
          // Unlock failed (likely a dead connection). Destroy it rather than returning
          // it to the pool so the session ends and Postgres frees the session-level lock
          // — otherwise a leaked lock would wedge every future tick into the skip path.
          log.warn('Failed to release appeals-VLM advisory lock; discarding connection', { err: String(unlockErr) }, MODULE);
          client.release(true);
        }
      } else {
        client.release();
      }
    }
  }
}
