/**
 * Shared pool for reporting services
 * Uses singleton pg Pool from @/lib/db (same as 68+ other API routes)
 * NOT @neondatabase/serverless Pool which uses WebSocket and times out
 */

import pool from '@/lib/db';

/**
 * Get pool instance for external use
 */
export function getPool() {
  return pool;
}

export { pool };
