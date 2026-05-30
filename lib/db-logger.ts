import type { NeonQueryFunction } from '@neondatabase/serverless';
import { sql as poolSql } from '@/lib/db-pool';
import { dbLogger } from './logger';

/**
 * Wraps SQL queries with automatic logging and performance tracking.
 *
 * Backed by the pg.Pool client from @/lib/db-pool (not the Neon driver). The
 * `databaseUrl` argument is retained for call-site compatibility but ignored —
 * db-pool uses the shared pg.Pool singleton (single dev+prod database). The
 * returned proxy preserves the same surface callers rely on: the tagged-template
 * call (logged here), plus `.query(text, params)` and `.unsafe(raw)` which pass
 * through to db-pool unchanged.
 */
/** Run a DB call with timing + slow/error logging. Shared by the tagged-template
 *  path and the `.query()` path so both are observable. */
async function runLogged<T>(queryPreview: string, paramCount: number, exec: () => Promise<T>): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await exec();
    const duration = Date.now() - startTime;
    const logData = {
      query: queryPreview,
      paramCount,
      rowCount: Array.isArray(result) ? result.length : 1,
      duration: `${duration}ms`,
      slow: duration > 1000,
    };
    if (duration > 1000) {
      dbLogger.warn(logData, `Slow query detected: ${duration}ms`);
    } else if (process.env.LOG_LEVEL === 'debug') {
      dbLogger.debug(logData, 'Database query executed');
    }
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    dbLogger.error({
      query: queryPreview,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: `${duration}ms`,
      paramCount,
    }, 'Database query failed');
    throw error;
  }
}

const preview = (query: string): string => (query.length > 200 ? query.substring(0, 200) + '...' : query);

export function createLoggedSql(_databaseUrl?: string): NeonQueryFunction<false, false> {
  const baseSql = poolSql;

  return new Proxy(baseSql, {
    // Tagged-template call: sql`SELECT ...` (and legacy sql(text, params)).
    apply: (target, thisArg, argumentsList) => {
      const [first, ...rest] = argumentsList;
      const query = Array.isArray(first) ? first.join('$?') : String(first);
      const paramCount = Array.isArray(first)
        ? rest.length
        : (Array.isArray(rest[0]) ? rest[0].length : rest.length);
      return runLogged(preview(query), paramCount, () =>
        target.apply(thisArg, argumentsList as [strings: TemplateStringsArray, ...params: unknown[]])
      );
    },
    // Property access: wrap `.query(text, params)` so the parameterised path is
    // logged too; pass everything else (incl. the `.unsafe(raw)` sentinel
    // helper, which does NOT execute) through unchanged.
    get: (target, prop, receiver) => {
      if (prop === 'query') {
        const originalQuery = target.query.bind(target);
        return (text: string, params?: unknown[]) =>
          runLogged(preview(String(text)), Array.isArray(params) ? params.length : 0, () =>
            originalQuery(text, params)
          );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as NeonQueryFunction<false, false>;
}

/**
 * Track specific business operations with detailed logging
 */
export function logBusinessOperation(
  operation: string,
  data: Record<string, any>,
  result?: any
) {
  dbLogger.info({
    operation,
    ...data,
    ...(result && { result })
  }, `Business operation: ${operation}`);
}

/**
 * Log successful create operations
 */
export function logCreate(entity: string, id: string | number, data?: any) {
  dbLogger.info({
    operation: 'CREATE',
    entity,
    id,
    ...(data && { details: data })
  }, `Created ${entity} with ID: ${id}`);
}

/**
 * Log successful update operations
 */
export function logUpdate(entity: string, id: string | number, changes?: any) {
  dbLogger.info({
    operation: 'UPDATE',
    entity,
    id,
    ...(changes && { changes })
  }, `Updated ${entity} with ID: ${id}`);
}

/**
 * Log successful delete operations
 */
export function logDelete(entity: string, id: string | number) {
  dbLogger.info({
    operation: 'DELETE',
    entity,
    id
  }, `Deleted ${entity} with ID: ${id}`);
}

/**
 * Log authentication events
 */
export function logAuth(event: 'login' | 'logout' | 'signup' | 'failed', userId?: string, details?: any) {
  const logger = event === 'failed' ? dbLogger.warn : dbLogger.info;
  
  logger({
    event: `auth.${event}`,
    userId,
    ...(details && { details })
  }, `Authentication event: ${event}`);
}