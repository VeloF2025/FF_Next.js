/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires, no-console, no-undef, no-redeclare */
/* global EdgeRuntime */
import { neon, neonConfig, Pool } from '@neondatabase/serverless';

// Enhanced pooling configuration for Neon
// This module provides optimized connection pooling for different environments

// Configure query concurrency limits
const DEFAULT_POOL_QUERY_LIMIT = 10;
const poolQueryLimit = Number(process.env.NEON_POOL_QUERY_LIMIT || DEFAULT_POOL_QUERY_LIMIT);

if (!Number.isNaN(poolQueryLimit) && poolQueryLimit > 0) {
  neonConfig.poolQueryLimit = poolQueryLimit;  // Max concurrent queries per connection
}

// Enable connection caching for better performance
neonConfig.fetchConnectionCache = true;

// Configure transport for Node.js environments (not in browser/edge)
// Set NEON_USE_HTTP=true to force HTTP transport (more reliable, slightly slower)
// Set NEON_USE_HTTP=false or unset to use WebSocket (faster, but connections can go stale)
const useHttpTransport = process.env.NEON_USE_HTTP === 'true';

if (typeof window === 'undefined' && typeof EdgeRuntime === 'undefined') {
  if (useHttpTransport) {
    // HTTP transport - more reliable for persistent servers
    // Connections don't go stale, no WebSocket reconnection issues
    console.log('[DB] Using HTTP transport (NEON_USE_HTTP=true)');
  } else {
    // WebSocket transport - faster but requires connection management
    // Try to use WebSocket for better performance in Node.js if available
    try {
      const ws = require('ws');
      neonConfig.webSocketConstructor = ws;
      console.log('[DB] Using WebSocket transport');
    } catch {
      // ws package not available, will use built-in fetch
      console.log('[DB] WebSocket not available, falling back to HTTP');
    }
  }
  
  // Configure WebSocket proxy (Neon v2 protocol)
  neonConfig.wsProxy = (host, port) => `${host}:${port}/v2`;
  
  // Use secure WebSocket connections
  neonConfig.useSecureWebSocket = true;
  
  // Pipeline authentication for faster connections
  neonConfig.pipelineConnect = 'password';
  
  // Enable automatic retries on transient errors
  neonConfig.fetchFunction = async (...args) => {
    const maxRetries = 3;
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(...args);
        if (!response.ok && response.status >= 500 && i < maxRetries - 1) {
          // Retry on server errors
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          // Exponential backoff: 100ms, 200ms, 400ms
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
          continue;
        }
      }
    }
    throw lastError || new Error('Request failed after retries');
  };
}

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
    
    // Connection pool size
    max: Number(process.env.NEON_POOL_MAX) || 20,  // Maximum number of connections
    min: Number(process.env.NEON_POOL_MIN) || 2,   // Minimum number of connections
    
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

  return neon(databaseUrl);
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
    // Use serverless client for edge/serverless
    // Note: Neon serverless client uses template literals, not parameterized queries
    // This is a simplified version - in production, use proper query building
    return await sql(query, params);
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