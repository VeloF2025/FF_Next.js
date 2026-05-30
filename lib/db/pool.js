/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires, no-console, no-undef, no-redeclare */
/* global EdgeRuntime */
import { Pool } from 'pg';
import { sql as poolSql } from '@/lib/db-pool';

// Connection pooling helpers for long-running (Node.js server) processes.
//
// Migrated off @neondatabase/serverless (2026-05-30): this module now uses the
// standard pg driver directly. The previous neonConfig transport block (HTTP vs
// WebSocket, wsProxy, retry fetch) only configured the Neon HTTP/WS driver and
// is inert under pg, so it was removed. The serverless `sql` client is delegated
// to @/lib/db-pool (pg.Pool-backed). This file currently has no importers; the
// re-point removes its last @neondatabase/serverless dependency.

/**
 * Create a connection pool for long-running processes
 * Use this for applications that maintain persistent connections
 * @returns {Pool} Configured Neon connection pool
 */
export function createPool() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Please configure it in your environment.');
  }

  return new Pool({
    connectionString: databaseUrl,

    // Connection pool size — tightened 2026-05-22 to match @/lib/db.ts after
    // the morning's pool-exhaustion incident (64 idle fibreflow_user connections
    // hit Supabase max_connections=100). Both this shim and the pg.Pool now
    // default to max 10 / min 1, capping the per-service footprint at ~20
    // (shim + pg.Pool) and the cross-env total at ~40, leaving plenty of
    // headroom below the 100-slot ceiling. NEON_POOL_MAX / NEON_POOL_MIN env
    // overrides still honored if set.
    max: Number(process.env.NEON_POOL_MAX) || 10,
    min: Number(process.env.NEON_POOL_MIN) || 1,

    // Connection lifecycle
    idleTimeoutMillis: Number(process.env.NEON_IDLE_TIMEOUT) || 30000,  // Close idle connections after 30s
    connectionTimeoutMillis: Number(process.env.NEON_CONNECT_TIMEOUT) || 5000,  // Connection timeout 5s
    
    // Query timeout
    query_timeout: Number(process.env.NEON_QUERY_TIMEOUT) || 30000,  // Query timeout 30s
    statement_timeout: Number(process.env.NEON_STATEMENT_TIMEOUT) || 30000,  // Statement timeout 30s
    
    // Connection behavior
    allowExitOnIdle: true,  // Allow process to exit if pool is idle
  });
}

/**
 * Create a serverless/edge-optimized SQL client
 * Use this for serverless functions, edge runtime, or one-off queries
 * @returns {ReturnType<typeof neon>} Neon SQL template function
 */
export function createServerlessClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Please configure it in your environment.');
  }

  // pg.Pool-backed tagged-template client (drop-in for the former neon() client).
  return poolSql;
}

// Global singleton pool for long-running processes
let globalPool = null;

/**
 * Get or create a shared connection pool
 * Ensures single pool instance across hot reloads in development
 * @returns {Pool} Shared connection pool instance
 */
export function getPool() {
  if (!globalPool) {
    globalPool = createPool();
    
    // Handle pool errors globally
    globalPool.on('error', (err) => {
      console.error('Unexpected pool error:', err);
    });
    
    // Log pool statistics in development
    if (process.env.NODE_ENV === 'development') {
      setInterval(() => {
        const { totalCount, idleCount, waitingCount } = globalPool;
        console.log(`Pool stats - Total: ${totalCount}, Idle: ${idleCount}, Waiting: ${waitingCount}`);
      }, 30000);  // Log every 30 seconds
    }
  }
  
  return globalPool;
}

// Export convenient SQL client for serverless/edge
export const sql = createServerlessClient();

// Export pool for long-running processes
export const pool = typeof window === 'undefined' && typeof EdgeRuntime === 'undefined' 
  ? getPool() 
  : null;

/**
 * Execute a query with automatic connection management
 * @param {string} query - SQL query string
 * @param {any[]} params - Query parameters
 * @returns {Promise<any[]>} Query results
 */
export async function query(query, params = []) {
  if (pool) {
    // Use pool for Node.js environments
    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  } else {
    // Edge/serverless fallback (no pg.Pool): db-pool's sql exposes a
    // parameterised .query(text, params) executor.
    return await sql.query(query, params);
  }
}

/**
 * Execute multiple queries in a transaction
 * @param {Function} callback - Async function that receives a client
 * @returns {Promise<any>} Transaction result
 */
export async function transaction(callback) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    // For serverless, use the existing transaction support
    const client = sql;
    try {
      await client`BEGIN`;
      const result = await callback(client);
      await client`COMMIT`;
      return result;
    } catch (error) {
      await client`ROLLBACK`;
      throw error;
    }
  }
}

// Graceful shutdown handling
if (typeof process !== 'undefined' && pool) {
  const shutdown = async () => {
    console.log('Closing database connection pool...');
    try {
      await pool.end();
      console.log('Pool closed successfully');
    } catch (error) {
      console.error('Error closing pool:', error);
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export default sql;