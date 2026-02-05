/**
 * Shared types for the Daily Audit Framework
 */

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'warning';
export type Priority = 'P0' | 'P1' | 'P2';

export interface TestResult {
  name: string;
  status: TestStatus;
  duration: number;  // ms
  message?: string;
  details?: Record<string, any>;
  priority: Priority;
}

export interface SuiteResult {
  name: string;
  description: string;
  priority: Priority;
  startTime: string;
  endTime: string;
  duration: number;  // ms
  tests: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    warnings: number;
  };
}

export interface AuditResult {
  name: string;
  version: string;
  environment: string;
  startTime: string;
  endTime: string;
  duration: number;
  suites: SuiteResult[];
  summary: {
    totalSuites: number;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    warnings: number;
    p0Failures: number;
    p1Failures: number;
  };
  status: 'healthy' | 'degraded' | 'unhealthy';
}

export interface AuditSuite {
  name: string;
  description: string;
  priority: Priority;
  run(): Promise<SuiteResult>;
}

export interface ApiEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  requiresAuth: boolean;
  priority: Priority;
  description?: string;
}

export interface ServiceHealth {
  name: string;
  url: string;
  status: 'up' | 'down' | 'degraded';
  responseTime: number;
  lastCheck: string;
  details?: Record<string, any>;
}

export interface TableHealth {
  name: string;
  exists: boolean;
  rowCount: number | null;
  lastModified?: string;
}

/**
 * Create a test result helper
 */
export function createTestResult(
  name: string,
  status: TestStatus,
  duration: number,
  priority: Priority,
  message?: string,
  details?: Record<string, any>
): TestResult {
  return {
    name,
    status,
    duration,
    priority,
    message,
    details,
  };
}

/**
 * Create a suite result helper
 */
export function createSuiteResult(
  name: string,
  description: string,
  priority: Priority,
  tests: TestResult[],
  startTime: Date,
  endTime: Date
): SuiteResult {
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const skipped = tests.filter((t) => t.status === 'skipped').length;
  const warnings = tests.filter((t) => t.status === 'warning').length;

  return {
    name,
    description,
    priority,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    duration: endTime.getTime() - startTime.getTime(),
    tests,
    summary: {
      total: tests.length,
      passed,
      failed,
      skipped,
      warnings,
    },
  };
}

/**
 * Determine overall audit status
 */
export function determineStatus(result: AuditResult): 'healthy' | 'degraded' | 'unhealthy' {
  if (result.summary.p0Failures > 0) {
    return 'unhealthy';
  }
  if (result.summary.p1Failures > 0 || result.summary.warnings > 0) {
    return 'degraded';
  }
  return 'healthy';
}
