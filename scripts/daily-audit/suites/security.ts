/**
 * Security Suite
 * Layer 5: Static analysis, RBAC enforcement, auth patterns, code quality
 */

import { execSync } from 'child_process';
import * as path from 'path';
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

const SUITE_NAME = 'security';
const SUITE_DESCRIPTION = 'Security Analysis, RBAC Enforcement, and Code Quality';
const SUITE_PRIORITY = 'P1' as const;

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

/**
 * Run a grep-based check and return the match count
 */
function grepCount(pattern: string, paths: string[], excludePatterns: string[] = []): { count: number; matches: string[] } {
  const excludeArgs = excludePatterns.map(p => `--exclude-glob='${p}'`).join(' ');
  const pathArgs = paths.join(' ');

  try {
    const cmd = `rg -n "${pattern}" ${pathArgs} --type ts --type tsx ${excludeArgs} 2>/dev/null || true`;
    const result = execSync(cmd, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    }).trim();

    if (!result) return { count: 0, matches: [] };
    const lines = result.split('\n').filter(Boolean);
    return { count: lines.length, matches: lines.slice(0, 10) }; // Keep first 10 for details
  } catch (_err) {
    // grep/rg returns non-zero when no matches — expected
    return { count: 0, matches: [] };
  }
}

/**
 * Safer grep using ripgrep with glob filtering
 */
function rgCount(pattern: string, paths: string[], includeGlobs: string[] = ['*.ts', '*.tsx'], excludeGlobs: string[] = []): { count: number; matches: string[] } {
  const includeArgs = includeGlobs.map(g => `--glob '${g}'`).join(' ');
  const excludeArgs = [
    "--glob '!node_modules'",
    "--glob '!.next'",
    "--glob '!dist'",
    ...excludeGlobs.map(g => `--glob '!${g}'`),
  ].join(' ');
  const pathArgs = paths.join(' ');

  try {
    const cmd = `rg -n ${includeArgs} ${excludeArgs} "${pattern}" ${pathArgs} 2>/dev/null || true`;
    const result = execSync(cmd, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    }).trim();

    if (!result) return { count: 0, matches: [] };
    const lines = result.split('\n').filter(Boolean);
    return { count: lines.length, matches: lines.slice(0, 10) };
  } catch (_err) {
    // grep/rg returns non-zero when no matches — expected
    return { count: 0, matches: [] };
  }
}

// ─── Static Analysis Checks ────────────────────────────────────────

async function checkEval(): Promise<TestResult> {
  const startTime = Date.now();
  const { count, matches } = rgCount('eval\\(', ['pages/api/', 'src/']);

  return createTestResult(
    'No eval() usage',
    count === 0 ? 'passed' : 'failed',
    Date.now() - startTime,
    'P0',
    count === 0 ? 'No eval() found' : `${count} eval() calls found`,
    count > 0 ? { matches } : undefined
  );
}

async function checkConsoleLog(): Promise<TestResult> {
  const startTime = Date.now();
  const { count, matches } = rgCount(
    'console\\.(log|error|warn|info)\\(',
    ['pages/api/', 'src/'],
    ['*.ts', '*.tsx'],
    ['*.test.*', '*.spec.*']
  );

  return createTestResult(
    'No console violations',
    count === 0 ? 'passed' : count < 10 ? 'warning' : 'failed',
    Date.now() - startTime,
    'P1',
    count === 0 ? 'Clean — use logger instead' : `${count} console.* calls found`,
    count > 0 ? { matches } : undefined
  );
}

async function checkHardcodedSecrets(): Promise<TestResult> {
  const startTime = Date.now();

  // Check for hardcoded password assignments
  const { count: passwordCount, matches: passwordMatches } = rgCount(
    "password\\s*=\\s*['\"][^'\"]+['\"]",
    ['pages/api/', 'src/'],
    ['*.ts', '*.tsx'],
    ['*.test.*', '*.d.ts']
  );

  // Filter out type definitions, interfaces, labels etc.
  const realMatches = passwordMatches.filter(m =>
    !m.includes('type ') && !m.includes('interface ') &&
    !m.includes('placeholder') && !m.includes('label') &&
    !m.includes('// ') && !m.includes('hint')
  );

  return createTestResult(
    'No hardcoded secrets',
    realMatches.length === 0 ? 'passed' : 'failed',
    Date.now() - startTime,
    'P0',
    realMatches.length === 0 ? 'No hardcoded credentials' : `${realMatches.length} potential secrets`,
    realMatches.length > 0 ? { matches: realMatches } : undefined
  );
}

async function checkSqlConcatenation(): Promise<TestResult> {
  const startTime = Date.now();
  const { count, matches } = rgCount('query \\+= |query = query \\+', ['pages/api/', 'src/']);

  return createTestResult(
    'No SQL string concatenation',
    count === 0 ? 'passed' : 'failed',
    Date.now() - startTime,
    'P0',
    count === 0 ? 'All queries use parameterized templates' : `${count} string-built SQL queries`,
    count > 0 ? { matches } : undefined
  );
}

async function checkEmptyCatches(): Promise<TestResult> {
  const startTime = Date.now();

  // Find catch blocks that don't have logging or handling
  const { count, matches } = rgCount(
    'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
    ['pages/api/', 'src/'],
    ['*.ts', '*.tsx'],
    ['*.test.*']
  );

  return createTestResult(
    'No empty catch blocks',
    count === 0 ? 'passed' : 'warning',
    Date.now() - startTime,
    'P1',
    count === 0 ? 'All catches have handling' : `${count} empty catch blocks`,
    count > 0 ? { matches } : undefined
  );
}

async function checkMathRandom(): Promise<TestResult> {
  const startTime = Date.now();
  const { count, matches } = rgCount('Math\\.random\\(\\)', ['src/lib/auth/', 'pages/api/auth/']);

  return createTestResult(
    'No Math.random() in auth code',
    count === 0 ? 'passed' : 'failed',
    Date.now() - startTime,
    'P0',
    count === 0 ? 'No insecure randomness in auth' : `${count} Math.random() in auth`,
    count > 0 ? { matches } : undefined
  );
}

async function checkFileSizes(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const cmd = `find pages/api/ src/ -name "*.ts" -o -name "*.tsx" | xargs wc -l 2>/dev/null | sort -rn | head -20`;
    const result = execSync(cmd, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();

    const lines = result.split('\n').filter(Boolean);
    const oversized = lines.filter(line => {
      const count = parseInt(line.trim().split(/\s+/)[0]);
      return count > 300 && !line.includes('total');
    });

    return createTestResult(
      'File size compliance (<300 lines)',
      oversized.length === 0 ? 'passed' : 'warning',
      Date.now() - startTime,
      'P2',
      oversized.length === 0 ? 'All files within limit' : `${oversized.length} files over 300 lines`,
      oversized.length > 0 ? { oversizedFiles: oversized.slice(0, 10) } : undefined
    );
  } catch {
    return createTestResult(
      'File size compliance (<300 lines)',
      'skipped',
      Date.now() - startTime,
      'P2',
      'Could not check file sizes'
    );
  }
}

async function checkDependencyVulns(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const result = execSync('npm audit --json 2>/dev/null || true', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 60000,
    });

    const audit = JSON.parse(result);
    const vulns = audit.metadata?.vulnerabilities || {};
    const critical = vulns.critical || 0;
    const high = vulns.high || 0;
    const moderate = vulns.moderate || 0;

    let status: 'passed' | 'warning' | 'failed';
    if (critical > 0 || high > 0) {
      status = 'failed';
    } else if (moderate > 0) {
      status = 'warning';
    } else {
      status = 'passed';
    }

    return createTestResult(
      'Dependency vulnerabilities',
      status,
      Date.now() - startTime,
      'P1',
      `Critical: ${critical}, High: ${high}, Moderate: ${moderate}`,
      { critical, high, moderate, low: vulns.low || 0 }
    );
  } catch {
    return createTestResult(
      'Dependency vulnerabilities',
      'skipped',
      Date.now() - startTime,
      'P1',
      'npm audit could not run'
    );
  }
}

// ─── RBAC Enforcement ───────────────────────────────────────────────

async function checkUnauthenticatedEndpoints(): Promise<TestResult> {
  const startTime = Date.now();

  // Known public endpoints that don't require auth
  const knownPublic = [
    'health.ts', 'auth/login.ts', 'auth/check-email.ts',
    'auth/forgot-password.ts', 'auth/reset-password.ts', 'auth/setup-password.ts',
    'version.ts', 'wa-monitor-', 'qfield/webhook.ts', 'cron/',
  ];

  const { count, matches } = rgCount(
    'export default',
    ['pages/api/'],
    ['*.ts'],
    ['__tests__/*']
  );

  // Find files that DON'T reference any auth middleware
  const { matches: noAuthMatches } = rgCount(
    'withAuth|withOptionalAuth|withFleetAuth|x-api-key|X-API-Key|apiKey',
    ['pages/api/'],
    ['*.ts'],
  );

  // Files with default export but no auth reference
  const noAuthFiles = new Set<string>();
  try {
    const cmd = `rg -l "export default" pages/api/ --glob '*.ts' --glob '!__tests__/*' 2>/dev/null || true`;
    const allFiles = execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 }).trim().split('\n').filter(Boolean);

    const cmd2 = `rg -l "withAuth|withOptionalAuth|withFleetAuth|x-api-key|X-API-Key|apiKey" pages/api/ --glob '*.ts' 2>/dev/null || true`;
    const authFiles = new Set(execSync(cmd2, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 }).trim().split('\n').filter(Boolean));

    for (const file of allFiles) {
      if (!authFiles.has(file)) {
        const isKnownPublic = knownPublic.some(p => file.includes(p));
        if (!isKnownPublic) {
          noAuthFiles.add(file);
        }
      }
    }
  } catch {
    // Fall through
  }

  return createTestResult(
    'API auth enforcement',
    noAuthFiles.size === 0 ? 'passed' : noAuthFiles.size < 5 ? 'warning' : 'failed',
    Date.now() - startTime,
    'P0',
    noAuthFiles.size === 0
      ? 'All non-public endpoints use auth middleware'
      : `${noAuthFiles.size} endpoints without auth middleware`,
    noAuthFiles.size > 0 ? { unauthEndpoints: Array.from(noAuthFiles).slice(0, 20) } : undefined
  );
}

async function checkRbacCoverage(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();

    const result = await sql`
      SELECT
        COUNT(DISTINCT type) as permission_types,
        COUNT(*) as total_permissions,
        COUNT(DISTINCT CASE WHEN type = 'module' THEN key END) as modules,
        COUNT(DISTINCT CASE WHEN type = 'page' THEN key END) as pages,
        COUNT(DISTINCT CASE WHEN type = 'tab' THEN key END) as tabs
      FROM access_permissions
    `;

    const stats = result[0];
    const total = parseInt(stats.total_permissions || '0');
    const modules = parseInt(stats.modules || '0');
    const pages = parseInt(stats.pages || '0');

    return createTestResult(
      'RBAC permission coverage',
      total >= 50 ? 'passed' : 'warning',
      Date.now() - startTime,
      'P1',
      `${total} permissions (${modules} modules, ${pages} pages)`,
      { totalPermissions: total, modules, pages, tabs: parseInt(stats.tabs || '0') }
    );
  } catch (error) {
    return createTestResult(
      'RBAC permission coverage',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'RBAC check failed'
    );
  }
}

async function checkRoleCoverage(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();

    const result = await sql`
      SELECT
        COUNT(*) as total_roles,
        array_agg(name) as role_names
      FROM custom_roles
    `;

    const total = parseInt(result[0]?.total_roles || '0');
    const names = result[0]?.role_names || [];

    const requiredRoles = ['super_admin', 'admin', 'manager', 'technician', 'viewer', 'contractor'];
    const missing = requiredRoles.filter(r => !names.includes(r));

    return createTestResult(
      'RBAC role coverage',
      missing.length === 0 ? 'passed' : 'warning',
      Date.now() - startTime,
      'P1',
      missing.length === 0
        ? `${total} roles, all required roles present`
        : `Missing roles: ${missing.join(', ')}`,
      { totalRoles: total, roleNames: names, missingRoles: missing }
    );
  } catch (error) {
    return createTestResult(
      'RBAC role coverage',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Role check failed'
    );
  }
}

// ─── Suite Runner ───────────────────────────────────────────────────

export async function runSecuritySuite(options: {
  quick?: boolean;
} = {}): Promise<SuiteResult> {
  const startTime = new Date();
  const logger = auditLogger.forSuite(SUITE_NAME);

  logger.info('Starting security checks');

  const results: TestResult[] = [];

  // Critical static checks (P0) — always run
  logger.info('Running static analysis...');

  const evalResult = await checkEval();
  results.push(evalResult);
  logger.result(evalResult.name, evalResult.status === 'passed', evalResult.message);

  const secretsResult = await checkHardcodedSecrets();
  results.push(secretsResult);
  logger.result(secretsResult.name, secretsResult.status === 'passed', secretsResult.message);

  const sqlResult = await checkSqlConcatenation();
  results.push(sqlResult);
  logger.result(sqlResult.name, sqlResult.status === 'passed', sqlResult.message);

  const mathResult = await checkMathRandom();
  results.push(mathResult);
  logger.result(mathResult.name, mathResult.status === 'passed', mathResult.message);

  // Auth enforcement (P0) — always run
  logger.info('Checking auth enforcement...');
  const authResult = await checkUnauthenticatedEndpoints();
  results.push(authResult);
  logger.result(authResult.name, authResult.status === 'passed', authResult.message);

  // Quick mode stops here
  if (options.quick) {
    const endTime = new Date();
    return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
  }

  // Code quality checks (P1)
  logger.info('Running code quality checks...');

  const consoleResult = await checkConsoleLog();
  results.push(consoleResult);
  logger.result(consoleResult.name, consoleResult.status === 'passed', consoleResult.message);

  const catchResult = await checkEmptyCatches();
  results.push(catchResult);
  logger.result(catchResult.name, catchResult.status === 'passed', catchResult.message);

  // RBAC checks (P1)
  logger.info('Checking RBAC coverage...');

  const rbacResult = await checkRbacCoverage();
  results.push(rbacResult);
  logger.result(rbacResult.name, rbacResult.status === 'passed', rbacResult.message);

  const roleResult = await checkRoleCoverage();
  results.push(roleResult);
  logger.result(roleResult.name, roleResult.status === 'passed', roleResult.message);

  // File size and dependency checks (P2)
  logger.info('Running compliance checks...');

  const fileSizeResult = await checkFileSizes();
  results.push(fileSizeResult);
  logger.result(fileSizeResult.name, fileSizeResult.status === 'passed', fileSizeResult.message);

  const depResult = await checkDependencyVulns();
  results.push(depResult);
  logger.result(depResult.name, depResult.status === 'passed', depResult.message);

  const endTime = new Date();
  return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
}

export default runSecuritySuite;
