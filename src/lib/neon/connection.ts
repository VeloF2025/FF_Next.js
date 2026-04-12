/**
 * Neon Database Connection Setup
 * Drizzle ORM with Neon Serverless PostgreSQL
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neonTables } from './schema';
import { log } from '@/lib/logger';
import { getNeonConnection, executeQuery } from './connectionPool';

type DbRow = Record<string, unknown>;

// Lazy initialization to prevent connection attempts in browser
let sql: ReturnType<typeof getNeonConnection> | null = null;
let _neonDb: ReturnType<typeof drizzle> | null = null;

// Get SQL connection lazily
function getSql() {
  if (!sql) {
    sql = getNeonConnection();
  }
  return sql;
}

// Create Drizzle instance lazily
export const neonDb = new Proxy({} as ReturnType<typeof drizzle>, {
  get(target, prop) {
    if (!_neonDb) {
      _neonDb = drizzle(getSql(), { schema: neonTables });
    }
    return _neonDb[prop as keyof typeof _neonDb];
  }
});

// Alias for backward compatibility
export const db = neonDb;

// Connection test utility
export async function testNeonConnection(): Promise<boolean> {
  try {
    await getSql()`SELECT NOW() as current_time`;

    return true;
  } catch (error) {
    log.error('Neon connection failed:', { data: error }, 'connection');
    return false;
  }
}

// Database utilities
export const neonUtils = {
  /**
   * Test database connection
   */
  async ping(): Promise<{ success: boolean; timestamp?: string; error?: string }> {
    try {
      const result = await executeQuery(sql => sql`SELECT NOW() as timestamp`);
      const firstRow = Array.isArray(result) && result.length > 0 ? result[0] : null;
      return {
        success: true,
        timestamp: firstRow && typeof firstRow === 'object' && 'timestamp' in firstRow
          ? String((firstRow as DbRow).timestamp ?? new Date().toISOString())
          : new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Get database version and info
   */
  async getInfo(): Promise<DbRow | null> {
    try {
      const versionResult = await getSql()`SELECT VERSION() as version`;
      const sizeResult = await getSql()`
        SELECT 
          pg_size_pretty(pg_database_size(current_database())) as database_size,
          current_database() as database_name,
          current_user as user_name
      `;
      
      const versionRow = Array.isArray(versionResult) && versionResult.length > 0 ? versionResult[0] : null;
      const sizeRow = Array.isArray(sizeResult) && sizeResult.length > 0 ? sizeResult[0] : null;
      
      return {
        version: versionRow && typeof versionRow === 'object' && 'version' in versionRow
          ? String((versionRow as DbRow).version ?? 'Unknown')
          : 'Unknown',
        ...(sizeRow && typeof sizeRow === 'object' ? sizeRow : {}),
      };
    } catch (error) {
      log.error('Failed to get database info:', { data: error }, 'connection');
      return null;
    }
  },

  /**
   * Get table information
   */
  async getTableStats(): Promise<unknown[]> {
    try {
      const result = await getSql()`
        SELECT
          schemaname,
          tablename,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_tuples,
          n_dead_tup as dead_tuples
        FROM pg_stat_user_tables
        ORDER BY tablename;
      `;

      return Array.isArray(result) ? result : [];
    } catch (error) {
      log.error('Failed to get table stats:', { data: error }, 'connection');
      return [];
    }
  },

  /**
   * Execute raw SQL (use with caution)
   */
  async rawQuery(query: string): Promise<DbRow[]> {
    try {
      // Use template literal format for Neon (cast required by neon driver API)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await getSql()([query] as any as TemplateStringsArray) as DbRow[];
    } catch (error) {
      log.error('Raw query failed:', { data: error }, 'connection');
      throw error;
    }
  },
};