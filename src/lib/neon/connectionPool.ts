/**
 * Neon Database Connection Pool Configuration
 * Optimized connection management for better performance and reliability
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';


// Get the database URL with fallback
const getDatabaseUrl = (): string => {
  // Check if we're in the browser
  const isBrowser = typeof window !== 'undefined';
  
  if (isBrowser) {
    // In browser, return a dummy URL - we should use API routes instead
    log.warn('Database connection attempted from browser - use API routes instead', {}, 'connectionPool');
    return 'postgresql://dummy@localhost/dummy';
  }

  let databaseUrl: string | undefined;

  // Try Vite environment variable first (for server-side build)
  if (process.env?.NEXT_PUBLIC_DATABASE_URL) {
    databaseUrl = process.env.NEXT_PUBLIC_DATABASE_URL;
  }
  // Fall back to Node.js environment variables (server-side)
  else if (typeof process !== 'undefined' && process.env) {
    databaseUrl = process.env.DATABASE_URL;
  }

  // No fallback - environment variable is required for security
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required and not defined. Check your .env file.');
  }

  return databaseUrl;
};

// Create simple connection for Neon serverless
let simpleConnection: ReturnType<typeof neon> | null = null;

/**
 * Get or create the simple Neon connection (for serverless)
 */
export function getNeonConnection(): ReturnType<typeof neon> {
  if (!simpleConnection) {
    const databaseUrl = getDatabaseUrl();
    
    try {
      simpleConnection = neon(databaseUrl);
      
      log.info('Neon serverless connection created', {}, 'connectionPool');
      
    } catch (error) {
      log.error('Failed to create Neon connection:', { data: error }, 'connectionPool');
      throw error;
    }
  }
  
  return simpleConnection;
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<{ success: boolean; error?: string | undefined; timing?: number | undefined }> {
  const startTime = Date.now();
  
  try {
    const sql = getNeonConnection();
    await sql`SELECT 1 as test`;
    
    const timing = Date.now() - startTime;
    
    return {
      success: true,
      error: undefined,
      timing
    };
  } catch (error) {
    const timing = Date.now() - startTime;
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timing: timing
    };
  }
}

/**
 * Reset the cached connection (call on socket errors)
 */
export function resetConnection(): void {
  if (simpleConnection) {
    log.info('Resetting stale Neon connection', {}, 'connectionPool');
    simpleConnection = null;
  }
}

/**
 * Check if error is a recoverable socket/connection error
 */
function isRecoverableError(error: Error): boolean {
  const recoverablePatterns = [
    'socket hang up',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'fetch failed',
    'network error',
    'connection terminated',
    'Connection terminated unexpectedly',
  ];

  return recoverablePatterns.some(pattern =>
    error.message.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Execute a query with automatic retry logic
 */
export async function executeQuery<T = any>(
  queryFn: (sql: ReturnType<typeof neon>) => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const sql = getNeonConnection();
      return await queryFn(sql);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      log.warn(`Query attempt ${attempt + 1} failed:`, {
        data: { error: lastError.message, attempt }
      }, 'connectionPool');

      // Don't retry on authentication errors
      if (lastError.message.includes('password authentication failed')) {
        break;
      }

      // Reset connection on recoverable socket errors
      if (isRecoverableError(lastError)) {
        resetConnection();
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Query failed after retries');
}

/**
 * Health check for the connection
 */
export async function healthCheck(): Promise<{
  isHealthy: boolean;
  lastCheck: Date;
  error?: string | undefined;
  timing?: number | undefined;
}> {
  const result = await testConnection();
  
  return {
    isHealthy: result.success,
    lastCheck: new Date(),
    error: result.error || undefined,
    timing: result.timing || undefined
  };
}

/**
 * Gracefully close connections
 */
export async function closeConnections(): Promise<void> {
  try {
    // Simple connection doesn't need explicit closing in Neon serverless
    simpleConnection = null;
    log.info('Connection closed', {}, 'connectionPool');
    
  } catch (error) {
    log.error('Error closing connections:', { data: error }, 'connectionPool');
  }
}

// Export a function to get the connection (lazy loading)
export const getSql = () => getNeonConnection();