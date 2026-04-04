#!/usr/bin/env npx tsx
/**
 * Daily Audit Runner
 * Main orchestrator for the FibreFlow audit framework
 *
 * Loads .env.local for DATABASE_URL and other env vars
 */

// Load environment from .env.local before anything else
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

/*
 * Usage:
 *   tsx scripts/daily-audit/runner.ts              # Full audit
 *   tsx scripts/daily-audit/runner.ts --quick      # P0 only
 *   tsx scripts/daily-audit/runner.ts --suite api-health  # Single suite
 */

import { config } from './config';
import { auditLogger } from './utils/logger';
import {
  runApiHealthSuite,
  runDatabaseHealthSuite,
  runExternalServicesSuite,
  runNavigationSuite,
  runCrossModuleSuite,
  runDataIntegritySuite,
  runSecuritySuite,
  runPerformanceSuite,
  type SuiteName,
} from './suites';
import {
  writeHtmlReport,
  writeJsonReport,
  sendSlackNotification,
  getExitCode,
} from './reporters';
import {
  type AuditResult,
  type SuiteResult,
  determineStatus,
} from './types';

interface RunnerOptions {
  quick?: boolean;
  suite?: SuiteName;
  skipReports?: boolean;
  skipSlack?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): RunnerOptions {
  const args = process.argv.slice(2);
  const options: RunnerOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--quick' || arg === '-q') {
      options.quick = true;
    } else if (arg === '--suite' || arg === '-s') {
      options.suite = args[++i] as SuiteName;
    } else if (arg === '--skip-reports') {
      options.skipReports = true;
    } else if (arg === '--skip-slack') {
      options.skipSlack = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  process.stdout.write(`
FibreFlow Daily Audit Runner

Usage:
  tsx scripts/daily-audit/runner.ts [options]

Options:
  --quick, -q           Run P0 tests only (quick mode)
  --suite, -s <name>    Run a specific suite only
  --skip-reports        Skip generating reports
  --skip-slack          Skip Slack notifications
  --help, -h            Show this help message

Available suites:
  database-health       Database connectivity and health
  external-services     External service integrations
  data-integrity        Orphan detection, business rules, data freshness
  api-health            API endpoint health checks
  navigation            Navigation and route health
  cross-module          Cross-module integration tests
  security              Static analysis, RBAC enforcement, code quality
  performance           Response baselines, DB benchmarks, resource health

Examples:
  tsx scripts/daily-audit/runner.ts              # Full audit
  tsx scripts/daily-audit/runner.ts --quick      # P0 only
  tsx scripts/daily-audit/runner.ts -s api-health  # Single suite
`);
}

/**
 * Get suite runner by name
 */
function getSuiteRunner(name: SuiteName): ((options: { quick?: boolean }) => Promise<SuiteResult>) | null {
  const runners: Record<SuiteName, (options: { quick?: boolean }) => Promise<SuiteResult>> = {
    'api-health': runApiHealthSuite,
    'database-health': runDatabaseHealthSuite,
    'external-services': runExternalServicesSuite,
    'navigation': runNavigationSuite,
    'cross-module': runCrossModuleSuite,
    'data-integrity': runDataIntegritySuite,
    'security': runSecuritySuite,
    'performance': runPerformanceSuite,
  };

  return runners[name] || null;
}

/**
 * Run all suites
 */
async function runAllSuites(options: RunnerOptions): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];

  // Define suite execution order (layers 1-6)
  const suiteOrder: SuiteName[] = [
    'database-health',     // L1: Infrastructure - DB (run first, others depend on it)
    'external-services',   // L1: Infrastructure - services
    'data-integrity',      // L2: Data integrity, orphans, business rules
    'api-health',          // L3: Functional - API endpoints
    'navigation',          // L4: UI/UX - route health
    'cross-module',        // L3: Functional - integration workflows
    'security',            // L5: Security analysis
    'performance',         // L6: Performance baselines (run last)
  ];

  // Filter suites for quick mode
  const suitesToRun = options.quick
    ? suiteOrder.filter((s) => config.priorities.P0.includes(s))
    : suiteOrder;

  for (const suiteName of suitesToRun) {
    auditLogger.section(`Suite: ${suiteName}`);

    const runner = getSuiteRunner(suiteName);
    if (!runner) {
      auditLogger.error(`Unknown suite: ${suiteName}`);
      continue;
    }

    try {
      const result = await runner({ quick: options.quick });
      results.push(result);

      auditLogger.summary({
        passed: result.summary.passed,
        failed: result.summary.failed,
        skipped: result.summary.skipped,
        duration: result.duration,
      });
    } catch (error) {
      auditLogger.error(`Suite ${suiteName} failed with error`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

/**
 * Run a single suite
 */
async function runSingleSuite(suiteName: SuiteName, options: RunnerOptions): Promise<SuiteResult[]> {
  auditLogger.section(`Suite: ${suiteName}`);

  const runner = getSuiteRunner(suiteName);
  if (!runner) {
    auditLogger.error(`Unknown suite: ${suiteName}`);
    process.exit(1);
  }

  try {
    const result = await runner({ quick: options.quick });

    auditLogger.summary({
      passed: result.summary.passed,
      failed: result.summary.failed,
      skipped: result.summary.skipped,
      duration: result.duration,
    });

    return [result];
  } catch (error) {
    auditLogger.error(`Suite ${suiteName} failed with error`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

/**
 * Aggregate suite results into audit result
 */
function aggregateResults(suites: SuiteResult[], startTime: Date, endTime: Date): AuditResult {
  const summary = {
    totalSuites: suites.length,
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    warnings: 0,
    p0Failures: 0,
    p1Failures: 0,
  };

  for (const suite of suites) {
    summary.totalTests += suite.summary.total;
    summary.passed += suite.summary.passed;
    summary.failed += suite.summary.failed;
    summary.skipped += suite.summary.skipped;
    summary.warnings += suite.summary.warnings;

    // Count priority-based failures
    for (const test of suite.tests) {
      if (test.status === 'failed') {
        if (test.priority === 'P0') {
          summary.p0Failures++;
        } else if (test.priority === 'P1') {
          summary.p1Failures++;
        }
      }
    }
  }

  const result: AuditResult = {
    name: config.name,
    version: config.version,
    environment: config.environment,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    duration: endTime.getTime() - startTime.getTime(),
    suites,
    summary,
    status: 'healthy',  // Will be updated
  };

  result.status = determineStatus(result);

  return result;
}

/**
 * Main runner function
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const startTime = new Date();

  // Print header
  auditLogger.section(`FibreFlow Daily Audit v${config.version}`);
  auditLogger.info(`Environment: ${config.environment}`);
  auditLogger.info(`Mode: ${options.quick ? 'Quick (P0 only)' : 'Full'}`);

  if (options.suite) {
    auditLogger.info(`Running single suite: ${options.suite}`);
  }

  // Run suites
  let suites: SuiteResult[];

  if (options.suite) {
    suites = await runSingleSuite(options.suite, options);
  } else {
    suites = await runAllSuites(options);
  }

  const endTime = new Date();

  // Aggregate results
  const result = aggregateResults(suites, startTime, endTime);

  // Print final summary
  auditLogger.section('Audit Complete');
  auditLogger.info(`Status: ${result.status.toUpperCase()}`);
  auditLogger.summary({
    passed: result.summary.passed,
    failed: result.summary.failed,
    skipped: result.summary.skipped,
    duration: result.duration,
  });

  if (result.summary.p0Failures > 0) {
    auditLogger.error(`🚨 ${result.summary.p0Failures} P0 FAILURES`);
  }
  if (result.summary.p1Failures > 0) {
    auditLogger.warn(`⚠️ ${result.summary.p1Failures} P1 Failures`);
  }

  // Generate reports
  if (!options.skipReports) {
    auditLogger.info('Generating reports...');

    try {
      const htmlPath = await writeHtmlReport(result);
      auditLogger.info(`HTML report: ${htmlPath}`);
    } catch (error) {
      auditLogger.error('Failed to write HTML report', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    try {
      const jsonPath = await writeJsonReport(result);
      auditLogger.info(`JSON report: ${jsonPath}`);
    } catch (error) {
      auditLogger.error('Failed to write JSON report', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Send Slack notification
  if (!options.skipSlack && config.slack.webhookUrl) {
    auditLogger.info('Sending Slack notification...');
    await sendSlackNotification(result);
  }

  // Exit with appropriate code
  const exitCode = getExitCode(result);
  process.exit(exitCode);
}

// Run
main().catch((error) => {
  auditLogger.error('Fatal error', {
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
