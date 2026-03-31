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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

export default pool;
export { pool };
/** Alias for pool — used by system services that import { db } */
export const db = pool;
