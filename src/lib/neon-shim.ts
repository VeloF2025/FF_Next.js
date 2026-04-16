/**
 * @neondatabase/serverless compatibility shim
 *
 * Replaces the Neon HTTP/WebSocket driver with a standard pg (node-postgres)
 * implementation so the existing neon`sql template` API works with any
 * PostgreSQL server, including self-hosted Supabase.
 *
 * Activated via webpack alias in next.config.js:
 *   '@neondatabase/serverless' → './src/lib/neon-shim'
 *
 * All 425+ API files that do:
 *   import { neon } from '@neondatabase/serverless';
 *   const sql = neon(process.env.DATABASE_URL!);
 *   const rows = await sql`SELECT ...`;
 * continue to work without modification.
 */

import { Pool, Client } from 'pg';
import type { PoolConfig } from 'pg';

// ---------------------------------------------------------------------------
// neonConfig — no-op object, matches @neondatabase/serverless API surface
// Properties like fetchConnectionCache and webSocketConstructor are ignored.
// ---------------------------------------------------------------------------
export const neonConfig: Record<string, unknown> = {
  fetchConnectionCache: true,
};

// ---------------------------------------------------------------------------
// Pool cache — one pg.Pool per connection string to avoid connection leaks
// ---------------------------------------------------------------------------
const poolCache = new Map<string, Pool>();

function getPool(connectionString: string): Pool {
  if (!poolCache.has(connectionString)) {
    const useSSL = connectionString.includes('sslmode=require');
    const config: PoolConfig = {
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    };
    poolCache.set(connectionString, new Pool(config));
  }
  return poolCache.get(connectionString)!;
}

// ---------------------------------------------------------------------------
// NeonQueryFunction type — matches the original export shape
// ---------------------------------------------------------------------------
export type NeonQueryFunction = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

// ---------------------------------------------------------------------------
// neon() — tagged-template factory, drop-in for @neondatabase/serverless
// ---------------------------------------------------------------------------
export function neon(
  connectionString: string
): NeonQueryFunction {
  const pool = getPool(connectionString);

  return async function sql(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Record<string, unknown>[]> {
    // Rebuild parameterised query from template parts
    let query = '';
    strings.forEach((str, i) => {
      query += str;
      if (i < values.length) query += `$${i + 1}`;
    });

    const result = await pool.query(query, values as unknown[]);
    return result.rows as Record<string, unknown>[];
  };
}

// Re-export pg Pool and Client so files that import them from
// @neondatabase/serverless continue to work.
export { Pool, Client };
