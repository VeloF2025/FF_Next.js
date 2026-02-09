/**
 * Shared query interface for reporting services
 * Uses neon() HTTP instead of Pool WebSocket to avoid socket hang up errors
 * on staging/production servers where WebSocket connections time out.
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Pool-compatible query wrapper using neon() HTTP
 * Returns { rows } to match pg Pool.query() interface used by all reporting services
 */
const pool = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query(text: string, params?: any[]) {
    const rows = await sql.query(text, params);
    return { rows };
  },
};

/**
 * Get pool-compatible instance for external use
 */
export function getPool() {
  return pool;
}

export { pool };
