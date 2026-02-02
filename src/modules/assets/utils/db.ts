/**
 * Asset Module Database Connection
 *
 * Provides database connection for the asset module.
 * This module is self-contained and uses its own connection.
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

let sql: NeonQueryFunction<false, false> | null = null;
let currentDatabaseUrl: string | null = null;

/**
 * Get database connection
 * Lazily initializes the connection on first use
 */
export function getDbConnection(): NeonQueryFunction<false, false> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // Re-initialize if DATABASE_URL changed (useful for testing)
  if (sql && currentDatabaseUrl === databaseUrl) {
    return sql;
  }

  sql = neon(databaseUrl);
  currentDatabaseUrl = databaseUrl;
  return sql;
}

/**
 * Reset database connection (for testing)
 */
export function resetDbConnection(): void {
  sql = null;
  currentDatabaseUrl = null;
}

/**
 * Validate database connection
 */
export async function validateConnection(): Promise<boolean> {
  try {
    const db = getDbConnection();
    await db`SELECT 1`;
    return true;
  } catch (error) {
    log.error('Asset module database connection failed', { error }, 'assets.db');
    return false;
  }
}
