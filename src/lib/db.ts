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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
  max: 20,
  min: 2,                           // keep 2 idle connections ready
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 30_000,  // 30s — Neon cold starts can take 10-15s
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
