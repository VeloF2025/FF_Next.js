// scripts/vlm-bench/harvest/db.ts
import { Pool } from 'pg';

/**
 * Read-only pool for the harvest.
 *
 * The connection string is read from the environment and never written to disk
 * or into a manifest. Harvest is strictly SELECT — the only table this repo's
 * bench ever writes is vlm_bench_runs, and that happens in the runner, not here.
 */
let pool: Pool | null = null;

export function harvestPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — export it before running harvest (see .claude/credentials.local.md)');
    }
    pool = new Pool({ connectionString, max: 4 });
  }
  return pool;
}

export async function closeHarvestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function selectRows<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await harvestPool().query(text, params);
  return res.rows as T[];
}
