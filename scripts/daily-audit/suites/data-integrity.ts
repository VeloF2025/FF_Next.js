/**
 * Data Integrity Suite
 * Layer 2: Orphan detection, referential integrity, business rules,
 * data freshness, and volume sanity checks
 */

import { auditLogger as logger } from '../utils/logger';
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

const SUITE_NAME = 'data-integrity';
const SUITE_DESCRIPTION = 'Data Integrity, Orphan Detection, and Business Rule Validation';
const SUITE_PRIORITY = 'P0' as const;

// ─── Orphan Detection ───────────────────────────────────────────────

interface OrphanCheck {
  name: string;
  query: string;
  priority: 'P0' | 'P1' | 'P2';
  /** If true, orphans are a warning not a failure (e.g. WA data may precede SOW) */
  warnOnly?: boolean;
}

const orphanChecks: OrphanCheck[] = [
  {
    name: 'Drops without project',
    query: `SELECT COUNT(*) as count FROM drops d LEFT JOIN projects p ON d.project_id = p.id WHERE p.id IS NULL AND d.project_id IS NOT NULL`,
    priority: 'P0',
  },
  {
    name: 'Staff without user',
    query: `SELECT COUNT(*) as count FROM staff s LEFT JOIN users u ON s.user_id = u.id WHERE u.id IS NULL AND s.user_id IS NOT NULL`,
    priority: 'P0',
  },
  {
    name: 'POs without supplier',
    query: `SELECT COUNT(*) as count FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id WHERE s.id IS NULL AND po.supplier_id IS NOT NULL`,
    priority: 'P0',
  },
  {
    name: 'Fleet records without vehicle',
    query: `SELECT COUNT(*) as count FROM fleet_check_records fcr LEFT JOIN fleet_vehicles fv ON fcr.vehicle_id = fv.id WHERE fv.id IS NULL`,
    priority: 'P0',
  },
  {
    name: 'BOQ items without BOQ',
    query: `SELECT COUNT(*) as count FROM boq_line_items bli LEFT JOIN boqs b ON bli.boq_id = b.id WHERE b.id IS NULL`,
    priority: 'P1',
  },
  {
    name: 'Permissions without role',
    query: `SELECT COUNT(*) as count FROM role_permissions rp LEFT JOIN custom_roles cr ON rp.role_id = cr.id WHERE cr.id IS NULL`,
    priority: 'P0',
  },
  {
    name: 'User overrides without user',
    query: `SELECT COUNT(*) as count FROM user_permission_overrides upo LEFT JOIN users u ON upo.user_id = u.id WHERE u.id IS NULL`,
    priority: 'P0',
  },
  {
    name: 'DR reviews without drop',
    query: `SELECT COUNT(*) as count FROM dr_photo_unified_reviews dpr LEFT JOIN drops d ON dpr.drop_number = d.drop_number WHERE d.id IS NULL`,
    priority: 'P1',
    warnOnly: true, // WA data may precede SOW import
  },
  {
    name: 'Tickets without project',
    query: `SELECT COUNT(*) as count FROM noc_tickets nt LEFT JOIN projects p ON nt.project_id = p.id WHERE p.id IS NULL AND nt.project_id IS NOT NULL`,
    priority: 'P1',
  },
  {
    name: 'Vehicle assignments without vehicle',
    query: `SELECT COUNT(*) as count FROM vehicle_project_assignments vpa LEFT JOIN fleet_vehicles fv ON vpa.vehicle_id = fv.id WHERE fv.id IS NULL`,
    priority: 'P1',
  },
  {
    name: 'Snags without project',
    query: `SELECT COUNT(*) as count FROM snags s LEFT JOIN projects p ON s.project_id = p.id WHERE p.id IS NULL AND s.project_id IS NOT NULL`,
    priority: 'P1',
  },
];

async function runOrphanChecks(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await loadDb();

  for (const check of orphanChecks) {
    const startTime = Date.now();
    try {
      const result = await sql.unsafe(check.query);
      const count = parseInt(result[0]?.count || '0', 10);
      const duration = Date.now() - startTime;

      let status: 'passed' | 'warning' | 'failed';
      if (count === 0) {
        status = 'passed';
      } else if (check.warnOnly) {
        status = 'warning';
      } else {
        status = 'failed';
      }

      results.push(createTestResult(
        `Orphan: ${check.name}`,
        status,
        duration,
        check.priority,
        count === 0 ? 'No orphans' : `${count} orphan records`,
        { count }
      ));
    } catch (error) {
      // Table might not exist — treat as skipped, not failure
      const msg = error instanceof Error ? error.message : 'Query failed';
      logger.warn(`Query error: ${msg}`);
      const isTableMissing = msg.includes('does not exist') || msg.includes('relation');
      results.push(createTestResult(
        `Orphan: ${check.name}`,
        isTableMissing ? 'skipped' : 'failed',
        Date.now() - startTime,
        check.priority,
        isTableMissing ? `Table not found — skipped` : msg
      ));
    }
  }

  return results;
}

// ─── Business Rule Validation ───────────────────────────────────────

interface BusinessRule {
  name: string;
  query: string;
  priority: 'P0' | 'P1' | 'P2';
  expectZero: boolean; // true = 0 rows means pass
}

const businessRules: BusinessRule[] = [
  {
    name: 'Duplicate drop numbers per project',
    query: `SELECT COUNT(*) as count FROM (SELECT drop_number, project_id FROM drops GROUP BY drop_number, project_id HAVING COUNT(*) > 1) dupes`,
    priority: 'P0',
    expectZero: true,
  },
  {
    name: 'Duplicate user emails',
    query: `SELECT COUNT(*) as count FROM (SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1) dupes`,
    priority: 'P0',
    expectZero: true,
  },
  {
    name: 'Active vehicles without license plate',
    query: `SELECT COUNT(*) as count FROM fleet_vehicles WHERE status = 'active' AND (license_plate IS NULL OR license_plate = '')`,
    priority: 'P1',
    expectZero: true,
  },
  {
    name: 'Approved POs without approver',
    query: `SELECT COUNT(*) as count FROM purchase_orders WHERE status = 'approved' AND approved_by IS NULL`,
    priority: 'P1',
    expectZero: true,
  },
  {
    name: 'Future-dated DR reviews',
    query: `SELECT COUNT(*) as count FROM dr_photo_unified_reviews WHERE created_at > NOW() + INTERVAL '1 hour'`,
    priority: 'P1',
    expectZero: true,
  },
  {
    name: 'Roles without any permissions',
    query: `SELECT COUNT(*) as count FROM custom_roles cr LEFT JOIN role_permissions rp ON cr.id = rp.role_id WHERE rp.id IS NULL`,
    priority: 'P1',
    expectZero: true,
  },
];

async function runBusinessRuleChecks(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await loadDb();

  for (const rule of businessRules) {
    const startTime = Date.now();
    try {
      const result = await sql.unsafe(rule.query);
      const count = parseInt(result[0]?.count || '0', 10);
      const duration = Date.now() - startTime;

      const passed = rule.expectZero ? count === 0 : count > 0;
      results.push(createTestResult(
        `Rule: ${rule.name}`,
        passed ? 'passed' : 'failed',
        duration,
        rule.priority,
        passed ? 'OK' : `${count} violations found`,
        { count }
      ));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Query failed';
      const isTableMissing = msg.includes('does not exist') || msg.includes('relation');
      results.push(createTestResult(
        `Rule: ${rule.name}`,
        isTableMissing ? 'skipped' : 'failed',
        Date.now() - startTime,
        rule.priority,
        isTableMissing ? 'Table not found — skipped' : msg
      ));
    }
  }

  return results;
}

// ─── Data Freshness ─────────────────────────────────────────────────

interface FreshnessCheck {
  name: string;
  query: string;
  maxAgeHours: number;
  priority: 'P0' | 'P1' | 'P2';
  /** Skip on weekends/holidays */
  weekdaysOnly?: boolean;
}

const freshnessChecks: FreshnessCheck[] = [
  {
    name: 'DR activity',
    query: `SELECT MAX(created_at) as latest FROM dr_photo_unified_reviews`,
    maxAgeHours: 48,
    priority: 'P1',
    weekdaysOnly: true,
  },
  {
    name: 'Fleet check-ins',
    query: `SELECT MAX(created_at) as latest FROM fleet_check_records`,
    maxAgeHours: 48,
    priority: 'P1',
    weekdaysOnly: true,
  },
  {
    name: 'NOC tickets',
    query: `SELECT MAX(created_at) as latest FROM noc_tickets`,
    maxAgeHours: 72,
    priority: 'P2',
    weekdaysOnly: true,
  },
];

function isWeekday(): boolean {
  const day = new Date().getDay();
  return day >= 1 && day <= 5;
}

async function runFreshnessChecks(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await loadDb();

  for (const check of freshnessChecks) {
    const startTime = Date.now();

    if (check.weekdaysOnly && !isWeekday()) {
      results.push(createTestResult(
        `Freshness: ${check.name}`,
        'skipped',
        0,
        check.priority,
        'Skipped on weekends'
      ));
      continue;
    }

    try {
      const result = await sql.unsafe(check.query);
      const latest = result[0]?.latest;
      const duration = Date.now() - startTime;

      if (!latest) {
        results.push(createTestResult(
          `Freshness: ${check.name}`,
          'warning',
          duration,
          check.priority,
          'No data found'
        ));
        continue;
      }

      const ageMs = Date.now() - new Date(latest).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      results.push(createTestResult(
        `Freshness: ${check.name}`,
        ageHours <= check.maxAgeHours ? 'passed' : 'warning',
        duration,
        check.priority,
        `Last record ${ageHours.toFixed(1)}h ago (limit: ${check.maxAgeHours}h)`,
        { latestRecord: latest, ageHours: parseFloat(ageHours.toFixed(1)) }
      ));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Query failed';
      const isTableMissing = msg.includes('does not exist') || msg.includes('relation');
      results.push(createTestResult(
        `Freshness: ${check.name}`,
        isTableMissing ? 'skipped' : 'failed',
        Date.now() - startTime,
        check.priority,
        isTableMissing ? 'Table not found — skipped' : msg
      ));
    }
  }

  return results;
}

// ─── Volume Sanity ──────────────────────────────────────────────────

interface VolumeCheck {
  table: string;
  minRows: number;
  maxRows: number;
  priority: 'P0' | 'P1' | 'P2';
}

const volumeChecks: VolumeCheck[] = [
  { table: 'users', minRows: 5, maxRows: 1000, priority: 'P0' },
  { table: 'projects', minRows: 1, maxRows: 500, priority: 'P0' },
  { table: 'drops', minRows: 100, maxRows: 200000, priority: 'P1' },
  { table: 'staff', minRows: 5, maxRows: 1000, priority: 'P1' },
  { table: 'fleet_vehicles', minRows: 1, maxRows: 500, priority: 'P1' },
  { table: 'purchase_orders', minRows: 1, maxRows: 10000, priority: 'P1' },
  { table: 'noc_tickets', minRows: 10, maxRows: 100000, priority: 'P2' },
  { table: 'access_permissions', minRows: 20, maxRows: 1000, priority: 'P0' },
  { table: 'custom_roles', minRows: 1, maxRows: 50, priority: 'P0' },
];

async function runVolumeChecks(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await loadDb();

  for (const check of volumeChecks) {
    const startTime = Date.now();
    try {
      const result = await sql.unsafe(`SELECT COUNT(*) as count FROM "${check.table}"`);
      const count = parseInt(result[0]?.count || '0', 10);
      const duration = Date.now() - startTime;

      let status: 'passed' | 'warning' | 'failed';
      let message: string;

      if (count < check.minRows) {
        status = 'warning';
        message = `${count} rows (expected >= ${check.minRows})`;
      } else if (count > check.maxRows) {
        status = 'warning';
        message = `${count} rows (expected <= ${check.maxRows})`;
      } else {
        status = 'passed';
        message = `${count} rows`;
      }

      results.push(createTestResult(
        `Volume: ${check.table}`,
        status,
        duration,
        check.priority,
        message,
        { count, min: check.minRows, max: check.maxRows }
      ));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Query failed';
      const isTableMissing = msg.includes('does not exist') || msg.includes('relation');
      results.push(createTestResult(
        `Volume: ${check.table}`,
        isTableMissing ? 'skipped' : 'failed',
        Date.now() - startTime,
        check.priority,
        isTableMissing ? 'Table not found — skipped' : msg
      ));
    }
  }

  return results;
}

// ─── Suite Runner ───────────────────────────────────────────────────

export async function runDataIntegritySuite(options: {
  quick?: boolean;
} = {}): Promise<SuiteResult> {
  const startTime = new Date();
  const suiteLogger = logger.forSuite(SUITE_NAME);

  suiteLogger.info('Starting data integrity checks');

  const results: TestResult[] = [];

  // Orphan detection (P0) — always run
  suiteLogger.info('Running orphan detection...');
  const orphanResults = await runOrphanChecks();
  for (const result of orphanResults) {
    results.push(result);
    suiteLogger.result(result.name, result.status === 'passed', result.message);
  }

  // Business rules (P0) — always run
  suiteLogger.info('Running business rule validation...');
  const ruleResults = await runBusinessRuleChecks();
  for (const result of ruleResults) {
    results.push(result);
    suiteLogger.result(result.name, result.status === 'passed', result.message);
  }

  // Quick mode stops here
  if (options.quick) {
    const endTime = new Date();
    return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
  }

  // Data freshness (P1)
  suiteLogger.info('Running data freshness checks...');
  const freshnessResults = await runFreshnessChecks();
  for (const result of freshnessResults) {
    results.push(result);
    suiteLogger.result(result.name, result.status === 'passed', result.message);
  }

  // Volume sanity (P1)
  suiteLogger.info('Running volume sanity checks...');
  const volumeResults = await runVolumeChecks();
  for (const result of volumeResults) {
    results.push(result);
    suiteLogger.result(result.name, result.status === 'passed', result.message);
  }

  const endTime = new Date();
  return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
}

export default runDataIntegritySuite;
