/**
 * Singleton Database Connection Pool
 *
 * Provides a shared PostgreSQL connection pool to prevent connection exhaustion
 * under load. All API routes should import this instead of creating their own pools.
 *
 * @example
 * ```typescript
 * import pool from '@/lib/db';
 *
 * const result = await pool.query('SELECT * FROM users');
 * ```
 *
 * For transactions:
 * ```typescript
 * const client = await pool.connect();
 * try {
 *   await client.query('BEGIN');
 *   // ... transaction queries
 *   await client.query('COMMIT');
 * } finally {
 *   client.release();
 * }
 * ```
 */

import { Pool } from 'pg';
import { log } from '@/lib/logger';
import { dbCircuitBreaker } from '@/lib/dbCircuitBreaker';

const useSSL = process.env.DATABASE_URL?.includes('sslmode=require') ?? false;

// Pool sizing tuned 2026-05-22 after a connection-pool exhaustion incident:
// 64 idle fibreflow_user connections hit Supabase max_connections=100 and
// blocked even psql admin connects. Cold-start hedging is no longer needed
// since the Neon→Supabase cutover (2026-04-18 per project_db_supabase.md).
//   - max 20 → 10            single service can no longer dominate the pool
//   - min 2 → 1              smaller idle baseline; warm-up still primes 1
//   - idleTimeout 300s → 30s evict idle quickly (matches lib/db/pool.js shim)
//   - connectionTimeout 30s → 5s  fail fast on saturation rather than hanging
// Footprint note (revised 2026-06-10 after a recurrence): the app pools are NOT
// the whole story. Supabase's own internals (supabase_admin/realtime/supavisor,
// authenticator/PostgREST, storage) hold ~36 of the 100 slots, leaving only ~61
// for fibreflow_user — against which the steady app idle floor (dev + prod × these
// pools) plus concurrent cron node/tsx processes already sits near 60. So headroom
// is thin and a cron spike tips it over, the DB refuses new connections, and the
// WhatsApp bridge's per-DR insert fails → acks silently drop. The durable fix is
// raising max_connections (host RAM is ample); these pools are already minimal.
// `application_name` is set so the NEXT saturation is diagnosable per env/pool
// (PORT 3000 = prod, 3005 = dev) instead of an anonymous block of idle connections.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  application_name: `ff-pg-${process.env.PORT || 'app'}`,
  max: 10,
  min: 1,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Warm up pool on startup so first user request doesn't hit a cold Neon connection
pool.connect()
  .then(client => { client.release(); log.info('[db] pool warmed up'); })
  .catch(err => log.warn('[db] pool warm-up failed, will retry on first query:', err.message));

export default pool;
export { pool };
/** Alias for pool — used by system services that import { db } */
export const db = pool;

/**
 * Tagged template SQL function — drop-in replacement for neon() serverless driver.
 *
 * Usage (identical to neon):
 *   import { sql } from '@/lib/db';
 *   const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
 *
 * Uses the pg Pool instead of Neon's WASM-based WebSocket driver,
 * eliminating "wasm streaming compile failed" errors on the server.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> {
  // Build parameterised query: sql`SELECT * FROM t WHERE id = ${id}`
  // → query = 'SELECT * FROM t WHERE id = $1', params = [id]
  let query = strings[0];
  for (let i = 0; i < values.length; i++) {
    query += `$${i + 1}${strings[i + 1]}`;
  }
  return dbCircuitBreaker.execute(async (): Promise<Record<string, unknown>[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (pool as any).query(query, values);
    return r.rows;
  });
}

/** Get circuit breaker stats for health checks */
export function getDbCircuitStats() {
  return dbCircuitBreaker.getStats();
}

/** Force-reset the circuit breaker (manual recovery) */
export function resetDbCircuit() {
  dbCircuitBreaker.reset();
}
