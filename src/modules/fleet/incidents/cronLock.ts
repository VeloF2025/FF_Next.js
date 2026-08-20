/**
 * Pinned-connection session advisory-lock helper for Fleet incident cron
 * endpoints.
 *
 * Mirrors the proven discipline in `pages/api/cron/appeals-vlm.ts`:
 * `pool.connect()` pins one physical connection, `pg_try_advisory_lock`
 * takes a non-blocking session-level lock on it, the caller's work runs while
 * that lock is held, and `pg_advisory_unlock`
 * releases it before the connection returns to the pool. If the unlock
 * query itself fails (most likely a dead connection), the connection is
 * destroyed via `client.release(true)` rather than returned — handing back
 * a connection that still thinks it holds the lock would otherwise leak
 * that lock for the life of the pool and wedge every future tick into the
 * skip path.
 *
 * The pinned client is handed to `work` but neither current endpoint uses it: both go
 * through the shared pool instead. That is fine — exclusion comes from the lock living on
 * this connection, not from the callback's queries sharing it — but do not read the
 * signature as a promise that the work is transactionally tied to the lock.
 *
 * Extracted from the endpoint (rather than left inline as in appeals-vlm)
 * so every PR6 cron endpoint shares one tested implementation instead of
 * re-deriving this sequencing per lock name.
 */
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { log } from '@/lib/logger';

const MODULE = 'FleetIncidentCronLock';

export type CronLockOutcome<T> = { ran: true; result: T } | { ran: false };

/**
 * Runs `work` while holding the named session advisory lock, or skips it
 * (returning `{ ran: false }`) when another run already holds it. The lock
 * and the query that took it always share the same `PoolClient` — acquiring
 * on one connection and unlocking on another would silently no-op the
 * unlock (session advisory locks are connection-scoped) and leak the lock.
 */
export async function runWithCronLock<T>(
  lockName: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<CronLockOutcome<T>> {
  const client = await pool.connect();
  let locked = false;
  try {
    const lockResult = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockName],
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) {
      log.info('[fleet-incident-cron-lock] another run holds the lock — skipping this tick', { lockName }, MODULE);
      return { ran: false };
    }
    const result = await work(client);
    return { ran: true, result };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
        client.release();
      } catch (unlockError) {
        log.warn(
          '[fleet-incident-cron-lock] failed to release advisory lock; discarding connection',
          { lockName, error: unlockError instanceof Error ? unlockError.message : String(unlockError) },
          MODULE,
        );
        client.release(true);
      }
    } else {
      client.release();
    }
  }
}
