/**
 * Lazy-loaded Neon SQL client for Next.js
 * Prevents immediate DATABASE_URL access on client-side
 * Handles stale WebSocket connections with automatic reconnection
 */

import { neon } from '@neondatabase/serverless';

// Lazy initialization to prevent connection attempts in browser
let sqlInstance: ReturnType<typeof neon> | null = null;

/**
 * Reset the cached SQL instance (call on socket errors)
 */
export function resetSqlConnection(): void {
  sqlInstance = null;
}

/**
 * Get the Neon SQL client with lazy initialization
 * This prevents immediate DATABASE_URL access on module import
 */
export function getSql(): ReturnType<typeof neon> {
  if (sqlInstance) {
    return sqlInstance;
  }

  // Check if we're in the browser
  const isBrowser = typeof window !== 'undefined';

  if (isBrowser) {
    // In browser, return a dummy client that throws informative errors
    // This prevents DATABASE_URL access on client side
    const dummySql = ((strings: TemplateStringsArray, ...values: any[]) => {
      throw new Error('Database operations cannot be performed in the browser. Use API routes instead.');
    }) as any as ReturnType<typeof neon>;

    dummySql.transaction = async (callback: any) => {
      throw new Error('Database transactions cannot be performed in the browser. Use API routes instead.');
    };

    sqlInstance = dummySql;
    return sqlInstance;
  }

  // Server-side: get DATABASE_URL safely
  let databaseUrl: string | undefined;

  // Server-only: never use NEXT_PUBLIC_ prefix (leaks credentials to client bundle)
  if (typeof process !== 'undefined' && process.env) {
    databaseUrl = process.env.DATABASE_URL;
  }

  // No fallback - environment variable is required for security
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required and not defined. Check your .env file.');
  }

  sqlInstance = neon(databaseUrl);
  return sqlInstance;
}

/**
 * Execute query with automatic retry on socket errors
 */
export async function executeWithRetry<T>(
  queryFn: () => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if it's a recoverable socket error
      const isSocketError = [
        'socket hang up',
        'ECONNRESET',
        'fetch failed',
        'connection terminated'
      ].some(pattern => lastError!.message.toLowerCase().includes(pattern.toLowerCase()));

      if (isSocketError) {
        resetSqlConnection();

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Don't retry on auth errors
      if (lastError.message.includes('password authentication failed')) {
        break;
      }
    }
  }

  throw lastError || new Error('Query failed after retries');
}

/**
 * Convenience export for lazy SQL access
 * Use this instead of importing sql directly
 */
export const sql = getSql();
