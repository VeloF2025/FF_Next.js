/**
 * Shared pool setup for reporting services
 * Private - not re-exported from barrel
 */

import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

// CRITICAL: Use correct Neon endpoint (ep-dry-night-a9qyh4sj)
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'process.env.DATABASE_URL',
});

/**
 * Get pool instance for external use
 */
export function getPool(): Pool {
  return pool;
}

export { pool };
