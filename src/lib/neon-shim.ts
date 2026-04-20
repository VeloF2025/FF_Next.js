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
// Extends with .query() and .unsafe() to match the Neon HTTP driver's API
// ---------------------------------------------------------------------------
/** Sentinel produced by `sql.unsafe(raw)`, inlined verbatim when the tagged
 *  template rebuilds the query. Not exported — callers never touch it. */
const UNSAFE_SYMBOL = Symbol('neon-shim:unsafe');
interface UnsafeFragment { readonly [UNSAFE_SYMBOL]: true; readonly value: string; }

function isUnsafe(v: unknown): v is UnsafeFragment {
  return typeof v === 'object' && v !== null && (v as UnsafeFragment)[UNSAFE_SYMBOL] === true;
}

export interface NeonQueryFunction {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Inlines a raw string verbatim into a tagged-template query, bypassing
   *  parameterisation. Mirrors the Neon HTTP driver's `sql.unsafe`. Use only
   *  for trusted input such as dynamic column lists or WHERE fragments. */
  unsafe(raw: string): UnsafeFragment;
}

// ---------------------------------------------------------------------------
// neon() — tagged-template factory, drop-in for @neondatabase/serverless
// Also exposes .query(text, params) for callers like db-pool.ts
// ---------------------------------------------------------------------------
export function neon(
  connectionString: string
): NeonQueryFunction {
  const pool = getPool(connectionString);

  const sqlFn = async function sql(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Record<string, unknown>[]> {
    // Rebuild the query: interpolate parameterised values as $N placeholders,
    // but inline sql.unsafe(...) sentinels verbatim.
    let query = '';
    const params: unknown[] = [];
    strings.forEach((str, i) => {
      query += str;
      if (i < values.length) {
        const v = values[i];
        if (isUnsafe(v)) {
          query += v.value;
        } else {
          params.push(v);
          query += `$${params.length}`;
        }
      }
    });

    const result = await pool.query(query, params);
    return result.rows as Record<string, unknown>[];
  };

  // .query(text, params) — parameterised pass-through.
  (sqlFn as NeonQueryFunction).query = async function(
    text: string,
    params: unknown[] = []
  ): Promise<Record<string, unknown>[]> {
    const result = await pool.query(text, params);
    return result.rows as Record<string, unknown>[];
  };

  // .unsafe(raw) — returns a sentinel that the tagged-template branch inlines
  // verbatim. Callers use it as: sql`WHERE ${sql.unsafe(whereClause)}`.
  (sqlFn as NeonQueryFunction).unsafe = function(raw: string): UnsafeFragment {
    return { [UNSAFE_SYMBOL]: true as const, value: raw };
  };

  return sqlFn as NeonQueryFunction;
}

// Re-export pg Pool and Client so files that import them from
// @neondatabase/serverless continue to work.
export { Pool, Client };
