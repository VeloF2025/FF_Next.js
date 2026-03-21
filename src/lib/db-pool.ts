/**
 * Centralized Connection Pool — FibreFlow
 *
 * Single source of truth for all database queries.
 * Wraps the pg.Pool singleton from src/lib/db.ts and exposes:
 *
 *  1. `sql` — tagged template literal compatible with neon() syntax
 *     Drop-in replacement for `const sql = neon(DATABASE_URL)`.
 *     Converts interpolated values to $N parameters automatically.
 *
 *  2. `query(text, params)` — explicit parameterized query helper
 *  3. `queryOne(text, params)` — returns first row or null
 *  4. `transaction(callback)` — wraps pg client for true ACID transactions
 *  5. `pool` — the raw pg.Pool instance for advanced use cases
 *
 * ---
 * Migration guide (neon -> db-pool):
 *
 *   // BEFORE
 *   import { neon } from '@neondatabase/serverless';
 *   const sql = neon(process.env.DATABASE_URL!);
 *   const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
 *
 *   // AFTER
 *   import { sql } from '@/lib/db-pool';
 *   const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
 *
 * For inline neon() calls inside functions:
 *
 *   // BEFORE — new connection per call (bad)
 *   async function getUser(id: string) {
 *     const sql = neon(process.env.DATABASE_URL!);
 *     return sql`SELECT * FROM users WHERE id = ${id}`;
 *   }
 *
 *   // AFTER — shared pool (good)
 *   import { sql } from '@/lib/db-pool';
 *   async function getUser(id: string) {
 *     return sql`SELECT * FROM users WHERE id = ${id}`;
 *   }
 *
 * For parameterized queries (pg-style):
 *
 *   import { query, queryOne } from '@/lib/db-pool';
 *   const rows = await query('SELECT * FROM users WHERE id = $1', [userId]);
 *   const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId]);
 *
 * For transactions (true ACID):
 *
 *   import { transaction } from '@/lib/db-pool';
 *   const result = await transaction(async (txn) => {
 *     await txn.query('INSERT INTO ...', [...]);
 *     const row = await txn.queryOne('SELECT ...', [...]);
 *     return row;
 *   });
 *
 * @see src/lib/db.ts - the underlying pg.Pool singleton
 */

import { pool } from './db';
import type { PoolClient } from 'pg';

// ============================================================================
// Types
// ============================================================================

export type SqlRow = Record<string, unknown>;

/** Transaction client context */
export interface TxnClient {
  query<T extends SqlRow = SqlRow>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends SqlRow = SqlRow>(text: string, params?: unknown[]): Promise<T | null>;
  client: PoolClient;
}

// ============================================================================
// Tagged Template Literal Adapter
// ============================================================================

/**
 * Drop-in replacement for `const sql = neon(DATABASE_URL)`.
 * Converts template literals to parameterized pg queries.
 *
 * @example
 * const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
 */
export async function sql<T extends SqlRow = SqlRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const text = strings.reduce((acc, str, i) => {
    return acc + str + (i < values.length ? `$${i + 1}` : '');
  }, '');
  const result = await pool.query<T>(text, values);
  return result.rows;
}

// ============================================================================
// Parameterized Query Helpers
// ============================================================================

export async function query<T extends SqlRow = SqlRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends SqlRow = SqlRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await pool.query<T>(text, params);
  return result.rows[0] ?? null;
}

// ============================================================================
// Transaction Support (true ACID)
// ============================================================================

export async function transaction<T>(
  callback: (txn: TxnClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txn: TxnClient = {
      client,
      async query<R extends SqlRow = SqlRow>(text: string, params: unknown[] = []): Promise<R[]> {
        const res = await client.query<R>(text, params);
        return res.rows;
      },
      async queryOne<R extends SqlRow = SqlRow>(text: string, params: unknown[] = []): Promise<R | null> {
        const res = await client.query<R>(text, params);
        return res.rows[0] ?? null;
      },
    };
    const result = await callback(txn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export { pool };
export default pool;
