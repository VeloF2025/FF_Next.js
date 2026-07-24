/**
 * Read-only pg.Pool for the QFieldCloud database (localhost:5433).
 * SELECT-only — this pool must never be used to mutate qfieldcloud_db.
 * Connection string comes from env (QFIELDCLOUD_DATABASE_URL); never hardcoded.
 */
import { Pool } from 'pg';
import { log } from '@/lib/logger';

const connectionString = process.env.QFIELDCLOUD_DATABASE_URL;

let pool: Pool | null = null;

export function getQfcPool(): Pool {
  if (!connectionString) {
    throw new Error('QFIELDCLOUD_DATABASE_URL is not set (report only runs on velo).');
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: false, // localhost:5433 only — never a remote host, so no TLS needed
      application_name: `ff-qfc-recon-${process.env.PORT || 'app'}`,
      max: 3,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => log.error('qfc-pool', { message: err.message }, 'idle client error'));
  }
  return pool;
}

export async function qfcQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string, params: unknown[] = [],
): Promise<T[]> {
  const res = await getQfcPool().query<T>(text, params);
  return res.rows;
}
