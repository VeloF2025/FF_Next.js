/**
 * NOC Module - Database Utility
 *
 * Thin wrapper around the shared db-pool abstraction.
 * Now backed by the pg.Pool singleton (true ACID transactions).
 *
 * MIGRATED: neon HTTP driver -> pg Pool (flow/neon-pool-phase-1)
 * - Transactions now ACID (was: neon HTTP, no atomicity guarantee)
 * - Parameterized query signatures unchanged
 */

import { query as poolQuery, queryOne as poolQueryOne, transaction as poolTransaction, pool } from "@/lib/db-pool";
import { createLogger } from "@/lib/logger";

const logger = createLogger("noc:db");

export async function query<T = Record<string, unknown>>(
  queryText: string,
  params: unknown[] = []
): Promise<T[]> {
  const startTime = Date.now();
  try {
    const rows = await poolQuery<T & Record<string, unknown>>(queryText, params);
    logger.debug("Query executed", {
      duration: Date.now() - startTime,
      rowCount: rows.length,
      query: queryText.substring(0, 100),
    });
    return rows as T[];
  } catch (error) {
    logger.error("Query failed", {
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
      query: queryText.substring(0, 100),
      paramsCount: params.length,
    });
    throw error;
  }
}

export async function queryOne<T = Record<string, unknown>>(
  queryText: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(queryText, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function transaction<T>(
  callback: (txn: {
    query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<R[]>;
    queryOne<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<R | null>;
  }) => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await poolTransaction(async (txn) => {
      return callback({
        query: <R = Record<string, unknown>>(text: string, params: unknown[] = []) =>
          txn.query<R & Record<string, unknown>>(text, params) as Promise<R[]>,
        queryOne: <R = Record<string, unknown>>(text: string, params: unknown[] = []) =>
          txn.queryOne<R & Record<string, unknown>>(text, params) as Promise<R | null>,
      });
    });
    logger.debug("Transaction completed", { duration: Date.now() - startTime });
    return result;
  } catch (error) {
    logger.error("Transaction failed", {
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
    throw error;
  }
}

export interface HealthCheckResult {
  isHealthy: boolean;
  latency?: number;
  error?: string;
  timestamp: Date;
}

export async function healthCheck(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  try {
    await pool.query("SELECT NOW() as now");
    const latency = Date.now() - startTime;
    logger.debug("Health check passed", { latency });
    return { isHealthy: true, latency, timestamp: new Date() };
  } catch (error) {
    const latency = Date.now() - startTime;
    logger.error("Health check failed", {
      error: error instanceof Error ? error.message : String(error),
      latency,
    });
    return {
      isHealthy: false,
      latency,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date(),
    };
  }
}

export async function closeConnection(): Promise<void> {
  logger.info("closeConnection() is a no-op for pg Pool (shared singleton)");
}

export const db = {
  query,
  queryOne,
  transaction,
  healthCheck,
  close: closeConnection,
};

export default db;
