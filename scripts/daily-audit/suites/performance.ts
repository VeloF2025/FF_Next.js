/**
 * Performance Suite
 * Layer 6: API response baselines, critical path timing, DB query performance,
 * memory/resource checks
 */

import { execSync } from 'child_process';
import * as os from 'os';
import { config, getBaseUrl_fn } from '../config';
import { httpClient } from '../utils/httpClient';
import { auditLogger } from '../utils/logger';
import {
  type SuiteResult,
  type TestResult,
  createTestResult,
  createSuiteResult,
} from '../types';

let sql: any;

async function loadDb(): Promise<void> {
  if (!sql) {
    const dbModule = await import('../../../lib/db/pool.js');
    sql = dbModule.sql;
  }
}

const SUITE_NAME = 'performance';
const SUITE_DESCRIPTION = 'Response Time Baselines, Critical Path Performance, and Resource Health';
const SUITE_PRIORITY = 'P2' as const;

// ─── API Response Time Baselines ────────────────────────────────────

interface EndpointBaseline {
  path: string;
  name: string;
  warningMs: number;
  criticalMs: number;
  priority: 'P0' | 'P1' | 'P2';
}

const endpointBaselines: EndpointBaseline[] = [
  // Critical paths
  { path: '/api/health', name: 'Health check', warningMs: 500, criticalMs: 2000, priority: 'P0' },
  { path: '/api/auth/me', name: 'Auth session', warningMs: 500, criticalMs: 2000, priority: 'P0' },
  { path: '/api/projects', name: 'Project list', warningMs: 1000, criticalMs: 3000, priority: 'P0' },

  // Module landing pages
  { path: '/api/activate/drops?limit=10', name: 'Activate DR list', warningMs: 1500, criticalMs: 4000, priority: 'P1' },
  { path: '/api/fleet/vehicles', name: 'Fleet vehicles', warningMs: 1000, criticalMs: 3000, priority: 'P1' },
  { path: '/api/staff', name: 'Staff list', warningMs: 1000, criticalMs: 3000, priority: 'P1' },
  { path: '/api/procurement/purchase-orders', name: 'PO list', warningMs: 1500, criticalMs: 4000, priority: 'P1' },
  { path: '/api/noc/wa-ticket', name: 'NOC ticket endpoint', warningMs: 1500, criticalMs: 4000, priority: 'P1' },
  { path: '/api/clients', name: 'Client list', warningMs: 1000, criticalMs: 3000, priority: 'P1' },
  { path: '/api/contractors', name: 'Contractor list', warningMs: 1000, criticalMs: 3000, priority: 'P1' },

  // Heavier endpoints
  { path: '/api/analytics/dashboard/stats', name: 'Analytics stats', warningMs: 2000, criticalMs: 5000, priority: 'P2' },
  { path: '/api/activate/reporting/trends', name: 'Activate trends report', warningMs: 3000, criticalMs: 8000, priority: 'P2' },
];

async function runEndpointBaselines(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const baseUrl = getBaseUrl_fn();

  for (const endpoint of endpointBaselines) {
    const startTime = Date.now();
    const url = `${baseUrl}${endpoint.path}`;

    const response = await httpClient.get(url);
    const responseTime = response.responseTime;

    let status: 'passed' | 'warning' | 'failed';
    if (!response.success && response.status !== 401 && response.status !== 403) {
      // Endpoint failed entirely — still report timing
      status = 'failed';
    } else if (responseTime > endpoint.criticalMs) {
      status = 'failed';
    } else if (responseTime > endpoint.warningMs) {
      status = 'warning';
    } else {
      status = 'passed';
    }

    results.push(createTestResult(
      `Perf: ${endpoint.name}`,
      status,
      responseTime,
      endpoint.priority,
      `${responseTime}ms (warn: ${endpoint.warningMs}ms, crit: ${endpoint.criticalMs}ms)`,
      {
        url: endpoint.path,
        responseTimeMs: responseTime,
        httpStatus: response.status,
        warningThreshold: endpoint.warningMs,
        criticalThreshold: endpoint.criticalMs,
      }
    ));
  }

  return results;
}

// ─── Database Query Performance ─────────────────────────────────────

interface QueryBenchmark {
  name: string;
  query: string;
  warningMs: number;
  criticalMs: number;
  priority: 'P0' | 'P1' | 'P2';
}

const queryBenchmarks: QueryBenchmark[] = [
  {
    name: 'Simple SELECT',
    query: `SELECT id, name FROM projects LIMIT 10`,
    warningMs: 100,
    criticalMs: 500,
    priority: 'P0',
  },
  {
    name: 'Count with WHERE',
    query: `SELECT COUNT(*) FROM drops WHERE project_id IS NOT NULL`,
    warningMs: 200,
    criticalMs: 1000,
    priority: 'P1',
  },
  {
    name: 'JOIN (projects + drops)',
    query: `SELECT p.name, COUNT(d.id) as drop_count FROM projects p LEFT JOIN drops d ON p.id = d.project_id GROUP BY p.id, p.name LIMIT 10`,
    warningMs: 300,
    criticalMs: 1500,
    priority: 'P1',
  },
  {
    name: 'Aggregate (PO totals)',
    query: `SELECT status, COUNT(*) as cnt, SUM(COALESCE(total_amount, 0)) as total FROM purchase_orders GROUP BY status`,
    warningMs: 300,
    criticalMs: 1500,
    priority: 'P1',
  },
  {
    name: 'Complex JOIN (DR reviews)',
    query: `SELECT COUNT(*) FROM dr_photo_unified_reviews dpr LEFT JOIN drops d ON dpr.drop_number = d.drop_number WHERE dpr.created_at > NOW() - INTERVAL '30 days'`,
    warningMs: 500,
    criticalMs: 2000,
    priority: 'P2',
  },
];

async function runQueryBenchmarks(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await loadDb();

  for (const benchmark of queryBenchmarks) {
    const startTime = Date.now();
    try {
      await sql.unsafe(benchmark.query);
      const duration = Date.now() - startTime;

      let status: 'passed' | 'warning' | 'failed';
      if (duration > benchmark.criticalMs) {
        status = 'failed';
      } else if (duration > benchmark.warningMs) {
        status = 'warning';
      } else {
        status = 'passed';
      }

      results.push(createTestResult(
        `DB Perf: ${benchmark.name}`,
        status,
        duration,
        benchmark.priority,
        `${duration}ms (warn: ${benchmark.warningMs}ms, crit: ${benchmark.criticalMs}ms)`,
        { queryTimeMs: duration, warningThreshold: benchmark.warningMs, criticalThreshold: benchmark.criticalMs }
      ));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Query failed';
      const isTableMissing = msg.includes('does not exist');
      results.push(createTestResult(
        `DB Perf: ${benchmark.name}`,
        isTableMissing ? 'skipped' : 'failed',
        Date.now() - startTime,
        benchmark.priority,
        isTableMissing ? 'Table not found — skipped' : msg
      ));
    }
  }

  return results;
}

// ─── Resource Health ────────────────────────────────────────────────

async function checkMemoryUsage(): Promise<TestResult> {
  const startTime = Date.now();
  const memUsage = process.memoryUsage();
  const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);

  let status: 'passed' | 'warning' | 'failed';
  if (heapMB > config.thresholds.memory.criticalMB) {
    status = 'failed';
  } else if (heapMB > config.thresholds.memory.warningMB) {
    status = 'warning';
  } else {
    status = 'passed';
  }

  return createTestResult(
    'Node.js memory usage',
    status,
    Date.now() - startTime,
    'P2',
    `Heap: ${heapMB}MB, RSS: ${rssMB}MB`,
    {
      heapUsedMB: heapMB,
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB,
      externalMB: Math.round(memUsage.external / 1024 / 1024),
    }
  );
}

async function checkDiskUsage(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const result = execSync("df -h / | tail -1 | awk '{print $5}'", {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const usagePercent = parseInt(result.replace('%', ''));

    let status: 'passed' | 'warning' | 'failed';
    if (usagePercent > 95) {
      status = 'failed';
    } else if (usagePercent > 80) {
      status = 'warning';
    } else {
      status = 'passed';
    }

    return createTestResult(
      'Disk usage',
      status,
      Date.now() - startTime,
      'P1',
      `${usagePercent}% used`,
      { usagePercent }
    );
  } catch (_err) {
    // df may not be available on all platforms
    return createTestResult(
      'Disk usage',
      'skipped',
      Date.now() - startTime,
      'P1',
      'Could not check disk usage'
    );
  }
}

async function checkSystemLoad(): Promise<TestResult> {
  const startTime = Date.now();
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg();
  const load1m = loadAvg[0];

  // Load above CPU count means overloaded
  let status: 'passed' | 'warning' | 'failed';
  if (load1m > cpuCount * 2) {
    status = 'failed';
  } else if (load1m > cpuCount) {
    status = 'warning';
  } else {
    status = 'passed';
  }

  return createTestResult(
    'System load',
    status,
    Date.now() - startTime,
    'P2',
    `Load: ${load1m.toFixed(2)} (${cpuCount} CPUs)`,
    {
      load1m,
      load5m: loadAvg[1],
      load15m: loadAvg[2],
      cpuCount,
    }
  );
}

async function checkDbConnectionCount(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();

    const result = await sql`
      SELECT COUNT(*) as active_connections
      FROM pg_stat_activity
      WHERE state = 'active'
    `;

    const activeConnections = parseInt(result[0]?.active_connections || '0');

    let status: 'passed' | 'warning' | 'failed';
    if (activeConnections > 50) {
      status = 'failed';
    } else if (activeConnections > 20) {
      status = 'warning';
    } else {
      status = 'passed';
    }

    return createTestResult(
      'DB active connections',
      status,
      Date.now() - startTime,
      'P1',
      `${activeConnections} active connections`,
      { activeConnections }
    );
  } catch (error) {
    return createTestResult(
      'DB active connections',
      'skipped',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Could not check connections'
    );
  }
}

// ─── Suite Runner ───────────────────────────────────────────────────

export async function runPerformanceSuite(options: {
  quick?: boolean;
} = {}): Promise<SuiteResult> {
  const startTime = new Date();
  const logger = auditLogger.forSuite(SUITE_NAME);

  logger.info('Starting performance checks');

  const results: TestResult[] = [];

  // Resource health (quick checks, always run)
  logger.info('Checking resource health...');

  const memResult = await checkMemoryUsage();
  results.push(memResult);
  logger.result(memResult.name, memResult.status === 'passed', memResult.message);

  const diskResult = await checkDiskUsage();
  results.push(diskResult);
  logger.result(diskResult.name, diskResult.status === 'passed', diskResult.message);

  const loadResult = await checkSystemLoad();
  results.push(loadResult);
  logger.result(loadResult.name, loadResult.status === 'passed', loadResult.message);

  const dbConnResult = await checkDbConnectionCount();
  results.push(dbConnResult);
  logger.result(dbConnResult.name, dbConnResult.status === 'passed', dbConnResult.message);

  // Quick mode stops here
  if (options.quick) {
    const endTime = new Date();
    return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
  }

  // DB query benchmarks
  logger.info('Running database query benchmarks...');
  const queryResults = await runQueryBenchmarks();
  for (const result of queryResults) {
    results.push(result);
    logger.result(result.name, result.status === 'passed', result.message);
  }

  // API endpoint baselines
  logger.info('Running API response time baselines...');
  const endpointResults = await runEndpointBaselines();
  for (const result of endpointResults) {
    results.push(result);
    logger.result(result.name, result.status === 'passed', result.message);
  }

  const endTime = new Date();
  return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
}

export default runPerformanceSuite;
