/**
 * The database identity the purge runs as — a seam, deliberately.
 *
 * Before migration 521 every PR4-7 table was append-only at the PERMISSION
 * level: the application role held SELECT/INSERT (and UPDATE on a few), and
 * DELETE on none of them. 521 grants that DELETE, because the purge runs
 * inside the Next.js app and the app process must hold the retention
 * credential either way — see that migration's header for the full trade.
 * Note what the grant costs: a compromised application account can now destroy
 * evidence about a driver, not merely add to it. The purge trigger is no
 * defence against a hostile caller — the app also holds UPDATE on
 * `fleet_operational_incidents`, so anything that could delete could first set
 * `lifecycle_status = 'dismissed'`. The trigger stops BUGS, not abuse.
 *
 * So the purge's identity is configuration, not a hard-wired import:
 *
 *   FLEET_RETENTION_DATABASE_URL unset -> the shared application pool
 *   FLEET_RETENTION_DATABASE_URL set   -> a dedicated pool for that role
 *
 * IT IS UNSET IN EVERY ENVIRONMENT, AND THAT IS THE DECISION, NOT AN UNFINISHED
 * STEP. Migration 521 grants fibreflow_user the DELETE the purge needs, so the
 * default path is the configured, working one. Setting this variable as things
 * stand would make the system strictly WORSE than either option alone: a second
 * privileged connection string to store and rotate, while the application role
 * keeps the DELETE anyway. If a dedicated role is ever introduced, 521 must be
 * rolled back in the same change, or the hole it opened stays open.
 *
 * The seam ships dormant because the DECISION could change, not because the
 * work is half-done. A standalone purge process — credentials the web app does
 * not have, so a compromised app cannot destroy evidence at all — is the
 * genuinely stronger design, and this is the hook it would use.
 *
 * A dedicated role would need DELETE on the same seven PR4-7 tables migration
 * 521 names (the six in `incidentPurge.PURGE_CHILD_STATEMENTS` that are Fleet
 * tables, plus `fleet_operational_incidents` itself), DELETE on
 * `user_notifications`, and UPDATE on
 * `fleet_operational_retention_items` (the completion stamp runs in the same
 * transaction). Nothing else — in particular, no INSERT anywhere.
 *
 * There is no fallback. If a dedicated identity is configured and cannot
 * connect, the purge fails; quietly reverting to the application pool would
 * hand back exactly the privilege this seam exists to withhold.
 */
import { Pool, type PoolClient } from 'pg';
import { transaction, type TxnClient } from '@/lib/db-pool';

let dedicatedPool: Pool | null = null;

export class RetentionIdentityConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'RetentionIdentityConfigError'; }
}

/**
 * Unset means "use the application pool". Set-but-blank means somebody TRIED
 * to configure a dedicated identity and got it wrong, and quietly reading that
 * as "unset" would select the MORE privileged pool — the failure direction has
 * to be away from privilege, so it is an error instead.
 */
function dedicatedConnectionString(): string | null {
  const configured = process.env.FLEET_RETENTION_DATABASE_URL;
  if (configured === undefined) return null;
  const trimmed = configured.trim();
  if (!trimmed) {
    throw new RetentionIdentityConfigError(
      'FLEET_RETENTION_DATABASE_URL is set but blank — unset it to use the application pool, or give it a valid connection string',
    );
  }
  return trimmed;
}

function getDedicatedPool(connectionString: string): Pool {
  if (!dedicatedPool) {
    // Small on purpose: this pool exists for one serialised nightly job, and a
    // privileged connection should be scarce.
    dedicatedPool = new Pool({ connectionString, max: 2 });
  }
  return dedicatedPool;
}

function buildTxnClient(client: PoolClient): TxnClient {
  return {
    client,
    async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
      const result = await client.query<R>(text, params);
      return result.rows;
    },
    async queryOne<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R | null> {
      const result = await client.query<R>(text, params);
      return result.rows[0] ?? null;
    },
  };
}

async function dedicatedTransaction<T>(connectionString: string, work: (txn: TxnClient) => Promise<T>): Promise<T> {
  const client = await getDedicatedPool(connectionString).connect();
  let rolledBack = false;
  try {
    await client.query('BEGIN');
    const result = await work(buildTxnClient(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The rollback failure is almost always the same dead connection that
      // caused the original error, and the original error is what the caller
      // needs to see. Discard the connection rather than return one that may
      // still be inside an aborted transaction.
      rolledBack = true;
    }
    throw error;
  } finally {
    client.release(rolledBack);
  }
}

/** Runs the purge transaction as the configured retention identity. */
export async function purgeTransaction<T>(work: (txn: TxnClient) => Promise<T>): Promise<T> {
  const connectionString = dedicatedConnectionString();
  if (!connectionString) return transaction(work);
  return dedicatedTransaction(connectionString, work);
}

/**
 * Validates the configured identity WITHOUT connecting.
 *
 * Call this once at the start of a run, before anything destructive. The
 * validity of this configuration is a property of the RUN, not of a
 * transaction, and resolving it lazily inside `purgeTransaction` put the error
 * AFTER the storage deletions — which destroyed attachments and then failed
 * with no database row removed. That is the same shape as the uuid-cast bug it
 * was introduced to avoid, one layer up.
 */
export function assertRetentionIdentityConfigured(): void {
  dedicatedConnectionString();
}

/** Which identity the purge would use, for logging. Never the connection string. */
export function retentionIdentityDescription(): 'application' | 'dedicated' {
  return dedicatedConnectionString() ? 'dedicated' : 'application';
}

/** Test seam: drops the cached pool so a spec can change the configured identity. */
export function __resetRetentionPoolForTests(): void {
  dedicatedPool = null;
}

/** Test seam: closes the cached pool so a spec does not leave a connection open. */
export async function __closeRetentionPoolForTests(): Promise<void> {
  const pool = dedicatedPool;
  dedicatedPool = null;
  if (pool) await pool.end();
}
