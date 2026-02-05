/**
 * Database Health Suite
 * Tests database connectivity, latency, table existence, and data integrity
 */

import { config, criticalTables } from '../config';
import { auditLogger } from '../utils/logger';
import {
  type SuiteResult,
  type TestResult,
  type TableHealth,
  createTestResult,
  createSuiteResult,
} from '../types';

// Dynamic import for database - only load when running
let sql: any;

async function loadDb(): Promise<void> {
  if (!sql) {
    const dbModule = await import('../../../lib/db/pool.js');
    sql = dbModule.sql;
  }
}

const SUITE_NAME = 'database-health';
const SUITE_DESCRIPTION = 'Database Connectivity and Health Checks';
const SUITE_PRIORITY = 'P0' as const;

/**
 * Test basic database connectivity
 */
async function testConnectivity(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();
    const result = await sql`SELECT 1 as check`;
    const duration = Date.now() - startTime;

    if (result && result[0]?.check === 1) {
      return createTestResult(
        'Database Connectivity',
        'passed',
        duration,
        'P0',
        `Connected in ${duration}ms`
      );
    }

    return createTestResult(
      'Database Connectivity',
      'failed',
      duration,
      'P0',
      'Invalid response from database'
    );
  } catch (error) {
    return createTestResult(
      'Database Connectivity',
      'failed',
      Date.now() - startTime,
      'P0',
      error instanceof Error ? error.message : 'Connection failed'
    );
  }
}

/**
 * Test database latency
 */
async function testLatency(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();

    // Run multiple queries to get average latency
    const samples = 5;
    const latencies: number[] = [];

    for (let i = 0; i < samples; i++) {
      const queryStart = Date.now();
      await sql`SELECT 1`;
      latencies.push(Date.now() - queryStart);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);
    const duration = Date.now() - startTime;

    let status: 'passed' | 'warning' | 'failed' = 'passed';
    let message = `Avg: ${avgLatency.toFixed(0)}ms, Max: ${maxLatency}ms`;

    if (avgLatency > config.thresholds.database.latencyCritical) {
      status = 'failed';
      message = `Critical latency: ${avgLatency.toFixed(0)}ms`;
    } else if (avgLatency > config.thresholds.database.latencyWarning) {
      status = 'warning';
      message = `High latency: ${avgLatency.toFixed(0)}ms`;
    }

    return createTestResult('Database Latency', status, duration, 'P0', message, {
      avgLatency,
      maxLatency,
      samples: latencies,
    });
  } catch (error) {
    return createTestResult(
      'Database Latency',
      'failed',
      Date.now() - startTime,
      'P0',
      error instanceof Error ? error.message : 'Latency test failed'
    );
  }
}

/**
 * Test that all critical tables exist
 */
async function testTableExistence(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    await loadDb();

    // Get list of existing tables
    const existingTables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;

    const tableNames = new Set(existingTables.map((t: { table_name: string }) => t.table_name));

    for (const table of criticalTables) {
      const startTime = Date.now();
      const exists = tableNames.has(table);

      results.push(
        createTestResult(
          `Table: ${table}`,
          exists ? 'passed' : 'failed',
          Date.now() - startTime,
          'P0',
          exists ? 'Exists' : 'Missing'
        )
      );
    }
  } catch (error) {
    results.push(
      createTestResult(
        'Table Existence Check',
        'failed',
        0,
        'P0',
        error instanceof Error ? error.message : 'Failed to check tables'
      )
    );
  }

  return results;
}

/**
 * Test row counts for critical tables
 */
async function testRowCounts(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Tables that must have data
  const dataRequiredTables = ['users', 'projects', 'custom_roles', 'access_permissions'];

  try {
    await loadDb();

    for (const table of dataRequiredTables) {
      const startTime = Date.now();

      try {
        // Use dynamic query safely
        const countResult = await sql.unsafe(`SELECT COUNT(*) as count FROM "${table}"`);
        const count = parseInt(countResult[0]?.count || '0', 10);
        const duration = Date.now() - startTime;

        results.push(
          createTestResult(
            `Row Count: ${table}`,
            count > 0 ? 'passed' : 'warning',
            duration,
            'P1',
            `${count} rows`,
            { count }
          )
        );
      } catch (error) {
        results.push(
          createTestResult(
            `Row Count: ${table}`,
            'failed',
            Date.now() - startTime,
            'P1',
            error instanceof Error ? error.message : 'Count failed'
          )
        );
      }
    }
  } catch (error) {
    results.push(
      createTestResult(
        'Row Count Check',
        'failed',
        0,
        'P1',
        error instanceof Error ? error.message : 'Failed to count rows'
      )
    );
  }

  return results;
}

/**
 * Test database version and configuration
 */
async function testDatabaseInfo(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();

    const versionResult = await sql`SELECT version()`;
    const version = versionResult[0]?.version || 'Unknown';
    const duration = Date.now() - startTime;

    // Check if it's PostgreSQL
    const isPostgres = version.toLowerCase().includes('postgresql');

    return createTestResult(
      'Database Version',
      isPostgres ? 'passed' : 'warning',
      duration,
      'P1',
      version.split(' ').slice(0, 2).join(' '),
      { fullVersion: version }
    );
  } catch (error) {
    return createTestResult(
      'Database Version',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Version check failed'
    );
  }
}

/**
 * Run the database health suite
 */
export async function runDatabaseHealthSuite(options: {
  quick?: boolean;
} = {}): Promise<SuiteResult> {
  const startTime = new Date();
  const logger = auditLogger.forSuite(SUITE_NAME);

  logger.info('Starting database health checks');

  const results: TestResult[] = [];

  // Test connectivity (P0)
  logger.info('Testing connectivity...');
  const connectivityResult = await testConnectivity();
  results.push(connectivityResult);
  logger.result(connectivityResult.name, connectivityResult.status === 'passed', connectivityResult.message);

  // If connectivity fails, skip other tests
  if (connectivityResult.status === 'failed') {
    logger.error('Database connectivity failed, skipping remaining tests');

    const endTime = new Date();
    return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
  }

  // Test latency (P0)
  logger.info('Testing latency...');
  const latencyResult = await testLatency();
  results.push(latencyResult);
  logger.result(latencyResult.name, latencyResult.status === 'passed', latencyResult.message);

  // Quick mode stops here
  if (options.quick) {
    const endTime = new Date();
    return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
  }

  // Test table existence (P0)
  logger.info('Testing table existence...');
  const tableResults = await testTableExistence();
  for (const result of tableResults) {
    results.push(result);
    logger.result(result.name, result.status === 'passed', result.message);
  }

  // Test row counts (P1)
  logger.info('Testing row counts...');
  const rowCountResults = await testRowCounts();
  for (const result of rowCountResults) {
    results.push(result);
    logger.result(result.name, result.status === 'passed', result.message);
  }

  // Test database info (P1)
  logger.info('Testing database info...');
  const dbInfoResult = await testDatabaseInfo();
  results.push(dbInfoResult);
  logger.result(dbInfoResult.name, dbInfoResult.status === 'passed', dbInfoResult.message);

  const endTime = new Date();

  return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
}

export default runDatabaseHealthSuite;
